package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:dist
var assets embed.FS

var panelTitles = map[string]string{
	"capture":  "添加日程",
	"inbox":    "整理箱",
	"week":     "周概览",
	"timeline": "时间轴",
}

var panelSizes = map[string][2]int{
	"capture":  {560, 760},
	"inbox":    {660, 760},
	"week":     {980, 720},
	"timeline": {980, 780},
}

type bounds struct {
	x      int
	y      int
	width  int
	height int
}

type panelWindow struct {
	panel          string
	window         *application.WebviewWindow
	createdAt      time.Time
	readyAt        time.Time
	initial        bounds
	lastMove       time.Time
	moveGeneration int
	userMoved      bool
	dragging       bool
	attachOnClose  bool
	closing        bool
}

type windowBridge struct {
	app          *application.App
	main         *application.WebviewWindow
	mu           sync.Mutex
	detached     map[string]*panelWindow
	attached     map[string]bool
	last         map[string]bounds
	previewPanel string
	previewTitle string
	quitting     bool
}

func (b *windowBridge) quit() {
	b.mu.Lock()
	if b.quitting {
		b.mu.Unlock()
		return
	}
	b.quitting = true
	// A pending preview must disappear as soon as the app starts closing.
	b.previewPanel = ""
	b.previewTitle = ""
	windows := make([]*panelWindow, 0, len(b.detached))
	for _, entry := range b.detached {
		entry.attachOnClose = true
		entry.closing = true
		windows = append(windows, entry)
	}
	b.mu.Unlock()

	for _, entry := range windows {
		entry.window.Close()
	}
	b.app.Quit()
}

func (b *windowBridge) allScreens() []*application.Screen {
	screens := b.app.Screen.GetAll()
	if len(screens) == 0 {
		return nil
	}
	return screens
}

func (b *windowBridge) getLastBounds(panel string) (bounds, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	value, ok := b.last[panel]
	return value, ok
}

func workArea(screen *application.Screen) bounds {
	if screen == nil {
		return bounds{0, 0, 1920, 1080}
	}
	area := screen.WorkArea
	if area.Width <= 0 || area.Height <= 0 {
		area = screen.Bounds
	}
	return bounds{area.X, area.Y, area.Width, area.Height}
}

func screenAtPoint(screens []*application.Screen, x, y int) *application.Screen {
	for _, screen := range screens {
		area := workArea(screen)
		if x >= area.x && x < area.x+area.width && y >= area.y && y < area.y+area.height {
			return screen
		}
	}
	return nil
}

func rectIntersects(a, b bounds) bool {
	return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y
}

func intersectionArea(a, b bounds) int {
	left := max(a.x, b.x)
	top := max(a.y, b.y)
	right := min(a.x+a.width, b.x+b.width)
	bottom := min(a.y+a.height, b.y+b.height)
	if right <= left || bottom <= top {
		return 0
	}
	return (right - left) * (bottom - top)
}

func clampToArea(value, minValue, maxValue int) int {
	if maxValue < minValue {
		return minValue
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func findWorkArea(screens []*application.Screen, rect bounds) bounds {
	if len(screens) == 0 {
		return bounds{0, 0, 1920, 1080}
	}
	best := workArea(screens[0])
	bestArea := -1
	for _, screen := range screens {
		area := workArea(screen)
		if area := intersectionArea(rect, area); area > bestArea {
			bestArea = area
			best = workArea(screen)
		}
	}
	return best
}

func (b *windowBridge) placeWindow(panel string, dropX, dropY int, hasDrop bool) (bounds, bounds) {
	screens := b.allScreens()
	mainX, mainY := b.main.Position()
	mainW, mainH := b.main.Size()
	mainRect := bounds{mainX, mainY, mainW, mainH}
	if len(screens) == 0 {
		area := bounds{0, 0, 1920, 1080}
		return bounds{mainX + mainW + 16, mainY + 48, 620, 720}, area
	}

	mainScreen := findWorkArea(screens, mainRect)
	size := panelSizes[panel]
	width, height := size[0], size[1]

	if hasDrop {
		if dropScreen := screenAtPoint(screens, dropX, dropY); dropScreen != nil {
			area := workArea(dropScreen)
			width = min(width, max(360, area.width-48))
			height = min(height, max(320, area.height-48))
			x := clampToArea(dropX-width/2, area.x+8, area.x+area.width-width-8)
			y := clampToArea(dropY-20, area.y+8, area.y+area.height-height-8)
			return bounds{x, y, width, height}, area
		}
	}

	width = min(width, max(360, mainScreen.width-48))
	height = min(height, max(320, mainScreen.height-48))

	if saved, ok := b.getLastBounds(panel); ok {
		if savedScreen := screenAtPoint(screens, saved.x+saved.width/2, saved.y+saved.height/2); savedScreen != nil {
			savedArea := workArea(savedScreen)
			width, height = saved.width, saved.height
			width = min(width, max(360, savedArea.width-48))
			height = min(height, max(320, savedArea.height-48))
			x := clampToArea(saved.x, savedArea.x, savedArea.x+savedArea.width-width)
			y := clampToArea(saved.y, savedArea.y, savedArea.y+savedArea.height-height)
			return bounds{x, y, width, height}, savedArea
		}
	}

	// Prefer the screen that contains the main window, then put the detached
	// window beside it so it does not overlap (and trigger a redock) at birth.
	rightX := mainX + mainW + 16
	leftX := mainX - width - 16
	chosenX := rightX
	if rightX+width > mainScreen.x+mainScreen.width {
		chosenX = leftX
	}
	if chosenX < mainScreen.x || chosenX+width > mainScreen.x+mainScreen.width {
		// Neither side has room (often the main window is maximized). Sit at
		// the right edge of the work area with a small overlap instead of
		// covering the middle of the main UI.
		chosenX = mainScreen.x + mainScreen.width - width - 24
	}
	chosenY := mainY + 48
	chosenY = clampToArea(chosenY, mainScreen.y, mainScreen.y+mainScreen.height-height)
	chosenX = clampToArea(chosenX, mainScreen.x, mainScreen.x+mainScreen.width-width)

	// If there is a second monitor to the right and the primary is full,
	// prefer placing the panel on that monitor instead of over the main UI.
	if rightX+width > mainScreen.x+mainScreen.width {
		for _, screen := range screens {
			area := workArea(screen)
			if area.x >= mainScreen.x+mainScreen.width && area.width >= width && area.height >= height {
				chosenX = area.x + 24
				chosenY = clampToArea(mainY, area.y+24, area.y+area.height-height-24)
				mainScreen = area
				break
			}
		}
	}

	return bounds{chosenX, chosenY, width, height}, mainScreen
}

func (b *windowBridge) detach(panel string, dropX, dropY int, hasDrop bool) (bool, error) {
	if _, ok := panelTitles[panel]; !ok {
		return false, errors.New("unknown panel")
	}

	b.mu.Lock()
	if b.quitting {
		b.mu.Unlock()
		return false, errors.New("application is closing")
	}
	if existing, ok := b.detached[panel]; ok {
		b.mu.Unlock()
		existing.window.UnMinimise()
		existing.window.Show()
		existing.window.Focus()
		return true, nil
	}
	b.mu.Unlock()

	placement, _ := b.placeWindow(panel, dropX, dropY, hasDrop)
	window := b.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "panel-" + panel,
		Title:            "阑珊时刻 · " + panelTitles[panel],
		URL:              "/?panel=" + url.QueryEscape(panel),
		Width:            placement.width,
		Height:           placement.height,
		X:                placement.x,
		Y:                placement.y,
		InitialPosition:  application.WindowXY,
		MinWidth:         360,
		MinHeight:        320,
		Frameless:        true,
		BackgroundColour: application.NewRGB(10, 10, 10),
		Windows: application.WindowsWindow{
			WindowDidMoveDebounceMS: 70,
			DisableIcon:             true,
		},
	})

	now := time.Now()
	entry := &panelWindow{
		panel:     panel,
		window:    window,
		createdAt: now,
		readyAt:   now.Add(900 * time.Millisecond),
		initial:   placement,
	}

	b.mu.Lock()
	if b.quitting {
		b.mu.Unlock()
		window.Close()
		return false, errors.New("application is closing")
	}
	if existing, ok := b.detached[panel]; ok {
		b.mu.Unlock()
		window.Close()
		existing.window.Show()
		existing.window.Focus()
		return true, nil
	}
	b.detached[panel] = entry
	b.mu.Unlock()

	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		b.handlePanelClosed(panel, entry)
	})
	window.OnWindowEvent(events.Common.WindowDidMove, func(*application.WindowEvent) {
		b.handlePanelMoved(panel, entry)
	})
	window.OnWindowEvent(events.Windows.WindowStartMove, func(*application.WindowEvent) {
		b.handlePanelDragStart(panel, entry)
	})
	window.OnWindowEvent(events.Windows.WindowEndMove, func(*application.WindowEvent) {
		b.handlePanelDragEnd(panel, entry)
	})
	window.Show()
	window.Focus()
	return false, nil
}

func (b *windowBridge) handlePanelClosed(panel string, entry *panelWindow) {
	x, y := entry.window.Position()
	w, h := entry.window.Size()
	b.mu.Lock()
	if entry.closing {
		b.mu.Unlock()
		return
	}
	entry.closing = true
	if !b.quitting && !entry.attachOnClose {
		b.attached[panel] = true
	}
	b.last[panel] = bounds{x, y, w, h}
	if current, ok := b.detached[panel]; ok && current == entry {
		delete(b.detached, panel)
	}
	if b.previewPanel == panel {
		b.previewPanel = ""
		b.previewTitle = ""
	}
	b.mu.Unlock()
}

func (b *windowBridge) attach(panel string) bool {
	b.mu.Lock()
	entry := b.detached[panel]
	if entry == nil {
		if _, ok := panelTitles[panel]; ok {
			b.attached[panel] = true
			b.mu.Unlock()
			return true
		}
		b.mu.Unlock()
		return false
	}
	entry.attachOnClose = true
	delete(b.detached, panel)
	b.attached[panel] = true
	if b.previewPanel == panel {
		b.previewPanel = ""
		b.previewTitle = ""
	}
	b.mu.Unlock()
	entry.window.Close()
	return true
}

func (b *windowBridge) panelAction(panel, action string) bool {
	b.mu.Lock()
	entry := b.detached[panel]
	b.mu.Unlock()
	if entry == nil {
		return false
	}
	switch action {
	case "attach", "close":
		return b.attach(panel)
	case "minimize":
		entry.window.Minimise()
	case "maximize":
		if entry.window.IsMaximised() {
			entry.window.Restore()
		} else {
			entry.window.Maximise()
		}
	case "fullscreen":
		if entry.window.IsFullscreen() {
			entry.window.UnFullscreen()
		} else {
			entry.window.Fullscreen()
		}
	case "focus":
		entry.window.UnMinimise()
		entry.window.Show()
		entry.window.Focus()
	case "start-move":
		b.mu.Lock()
		entry.userMoved = true
		entry.moveGeneration++
		b.mu.Unlock()
		return startNativeWindowMove(entry.window.NativeWindow())
	default:
		return false
	}
	return true
}

func (b *windowBridge) fitMainToScreen() {
	screens := b.allScreens()
	if len(screens) == 0 {
		return
	}
	x, y := b.main.Position()
	w, h := b.main.Size()
	area := findWorkArea(screens, bounds{x, y, w, h})
	if area.width <= 0 || area.height <= 0 {
		return
	}
	width := min(w, max(980, area.width-16))
	height := min(h, max(700, area.height-16))
	nextX := clampToArea(x, area.x+8, area.x+area.width-width-8)
	nextY := clampToArea(y, area.y+8, area.y+area.height-height-8)
	if width != w || height != h {
		b.main.SetSize(width, height)
	}
	if nextX != x || nextY != y {
		b.main.SetPosition(nextX, nextY)
	}
}

func (b *windowBridge) mainRect() bounds {
	x, y := b.main.Position()
	w, h := b.main.Size()
	return bounds{x, y, w, h}
}

func (b *windowBridge) panelInDockZone(entry *panelWindow) bool {
	x, y := entry.window.Position()
	w, h := entry.window.Size()
	if w <= 0 || h <= 0 {
		return false
	}
	main := b.mainRect()
	panel := bounds{x, y, w, h}
	area := intersectionArea(main, panel)
	if area*2 < w*h {
		return false
	}
	// Deliberately smaller than "the title is anywhere over the main window":
	// the cursor must bring the title into the central 64% of the main window
	// before redocking arms. This keeps brushing past the edge harmless.
	marginX := main.width * 18 / 100
	marginY := main.height * 18 / 100
	titleX, titleY := x+w/2, y+18
	return titleX >= main.x+marginX && titleX <= main.x+main.width-marginX &&
		titleY >= main.y+marginY && titleY <= main.y+main.height-marginY
}

func (b *windowBridge) updateDockPreview(panel string, entry *panelWindow) {
	active := b.panelInDockZone(entry)
	b.mu.Lock()
	defer b.mu.Unlock()
	if active {
		b.previewPanel = panel
		b.previewTitle = panelTitles[panel]
		return
	}
	if b.previewPanel == panel {
		b.previewPanel = ""
		b.previewTitle = ""
	}
}

func (b *windowBridge) clearDockPreview() {
	b.mu.Lock()
	b.previewPanel = ""
	b.previewTitle = ""
	b.mu.Unlock()
}

func (b *windowBridge) handlePanelDragStart(panel string, entry *panelWindow) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.quitting || entry.closing || b.detached[panel] != entry {
		return
	}
	entry.userMoved = true
	entry.dragging = true
	entry.moveGeneration++
}

func (b *windowBridge) handlePanelDragEnd(panel string, entry *panelWindow) {
	b.mu.Lock()
	if b.quitting || entry.closing || b.detached[panel] != entry {
		b.mu.Unlock()
		return
	}
	entry.dragging = false
	entry.moveGeneration++
	generation := entry.moveGeneration
	b.mu.Unlock()

	b.updateDockPreview(panel, entry)
	go b.watchPanelDrag(panel, entry, generation, false)
	go b.ensureOnScreen(panel, entry, generation)
}

func (b *windowBridge) handlePanelMoved(panel string, entry *panelWindow) {
	now := time.Now()
	b.mu.Lock()
	if b.quitting || entry.closing || b.detached[panel] != entry {
		b.mu.Unlock()
		return
	}
	if now.Before(entry.readyAt) {
		b.mu.Unlock()
		return
	}
	// Programmatic placement also emits WindowDidMove. Only a real drag
	// (StartMove or a held primary button) may arm the re-dock watcher;
	// otherwise a detached panel would immediately fly back into the main
	// window right after being created.
	if !entry.userMoved {
		if !leftButtonDown() {
			b.mu.Unlock()
			return
		}
		entry.userMoved = true
	}
	entry.lastMove = now
	if leftButtonDown() {
		entry.dragging = true
	}
	entry.moveGeneration++
	generation := entry.moveGeneration
	b.mu.Unlock()

	b.updateDockPreview(panel, entry)
	go b.ensureOnScreen(panel, entry, generation)
	go b.watchPanelDrag(panel, entry, generation, false)
}

func (b *windowBridge) watchPanelDrag(panel string, entry *panelWindow, generation int, onlyClamp bool) {
	// Wait for the user to release the mouse over the main window; otherwise
	// a detached window would vanish mid-drag as soon as it crosses the edge.
	overSince := time.Time{}
	for attempt := 0; attempt < 80; attempt++ {
		time.Sleep(120 * time.Millisecond)
		b.mu.Lock()
		if b.quitting || entry.closing || b.detached[panel] != entry || entry.moveGeneration != generation {
			b.mu.Unlock()
			return
		}
		b.mu.Unlock()

		if onlyClamp {
			continue
		}
		b.mu.Lock()
		paused := time.Since(entry.lastMove) >= 220*time.Millisecond
		b.mu.Unlock()
		if !paused {
			continue
		}
		over := b.panelInDockZone(entry)
		if !over {
			overSince = time.Time{}
			b.updateDockPreview(panel, entry)
			if attempt > 4 {
				return
			}
			continue
		}
		if overSince.IsZero() {
			overSince = time.Now()
		}
		if leftButtonDown() {
			continue
		}
		// Give the frame one extra beat after release before judging overlap.
		time.Sleep(150 * time.Millisecond)
		if b.panelInDockZone(entry) {
			b.attach(panel)
			return
		}
		overSince = time.Time{}
	}
}

func (b *windowBridge) ensureOnScreen(panel string, entry *panelWindow, generation int) {
	time.Sleep(450 * time.Millisecond)
	if leftButtonDown() {
		return
	}
	b.mu.Lock()
	if b.quitting || entry.closing || b.detached[panel] != entry || entry.moveGeneration != generation {
		b.mu.Unlock()
		return
	}
	b.mu.Unlock()

	x, y := entry.window.Position()
	w, h := entry.window.Size()
	rect := bounds{x, y, w, h}
	screens := b.allScreens()
	if len(screens) == 0 {
		return
	}
	for _, screen := range screens {
		if rectIntersects(rect, workArea(screen)) {
			return
		}
	}
	area := findWorkArea(screens, b.mainRect())
	nx := clampToArea(x, area.x, area.x+area.width-w)
	ny := clampToArea(y, area.y, area.y+area.height-h)
	entry.window.SetPosition(nx, ny)
	b.mu.Lock()
	b.last[panel] = bounds{nx, ny, w, h}
	b.mu.Unlock()
}

func (b *windowBridge) state() ([]string, []string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	detached := make([]string, 0, len(b.detached))
	for panel := range b.detached {
		detached = append(detached, panel)
	}
	attached := make([]string, 0, len(b.attached))
	for panel := range b.attached {
		attached = append(attached, panel)
	}
	sort.Strings(detached)
	sort.Strings(attached)
	return detached, attached
}

func (b *windowBridge) acknowledge(panel string) {
	b.mu.Lock()
	delete(b.attached, panel)
	b.mu.Unlock()
}

func (b *windowBridge) windowAction(action string) bool {
	switch action {
	case "minimize":
		b.main.Minimise()
	case "maximize":
		if b.main.IsMaximised() {
			b.main.Restore()
		} else {
			b.main.Maximise()
		}
	case "fullscreen":
		if b.main.IsFullscreen() {
			b.main.UnFullscreen()
		} else {
			b.main.Fullscreen()
		}
	case "close":
		go b.quit()
	case "start-move":
		return startNativeWindowMove(b.main.NativeWindow())
	default:
		return false
	}
	return true
}

func githubProxy(method, rawURL, body, contentType, token string) (int, string, error) {
	upper := strings.ToUpper(strings.TrimSpace(method))
	if upper != http.MethodGet && upper != http.MethodPost {
		return 0, "", fmt.Errorf("unsupported method")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || (parsed.Host != "github.com" && parsed.Host != "api.github.com") {
		return 0, "", fmt.Errorf("GitHub host required")
	}
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(upper, rawURL, reader)
	if err != nil {
		return 0, "", err
	}
	if contentType == "" {
		contentType = "application/json"
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return 0, "", err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024))
	return response.StatusCode, string(data), err
}

func openExternal(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" {
		return fmt.Errorf("unsupported URL")
	}
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL).Start()
}

var releaseTagPattern = regexp.MustCompile(`/releases/tag/(v?[0-9][^"'?#/]*)`)

// fetchLatestReleaseFromPage uses GitHub's public release redirect instead of
// the rate-limited REST API, so "check updates" works even after anonymous API
// quota is exhausted.
func fetchLatestReleaseFromPage() (string, string, error) {
	client := &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	pageURL := "https://github.com/sinsine/lanshan-moments/releases/latest"
	response, err := client.Get(pageURL)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	location := response.Header.Get("Location")
	if location == "" {
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
		if readErr != nil {
			return "", "", readErr
		}
		match := releaseTagPattern.FindSubmatch(data)
		if len(match) < 2 {
			return "", "", fmt.Errorf("release tag not found")
		}
		tag := string(match[1])
		return strings.TrimPrefix(tag, "v"), pageURL, nil
	}
	match := releaseTagPattern.FindStringSubmatch(location)
	if len(match) < 2 {
		return "", "", fmt.Errorf("release tag not found")
	}
	tag := match[1]
	releaseURL := location
	if strings.HasPrefix(releaseURL, "/") {
		releaseURL = "https://github.com" + releaseURL
	}
	return strings.TrimPrefix(tag, "v"), releaseURL, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (b *windowBridge) handler(static http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/health":
			writeJSON(w, http.StatusOK, map[string]any{
				"native":  true,
				"windows": true,
				"version": "0.5.1",
			})
		case "/api/detach":
			panel := r.URL.Query().Get("panel")
			dropX, xErr := strconv.Atoi(r.URL.Query().Get("x"))
			dropY, yErr := strconv.Atoi(r.URL.Query().Get("y"))
			hasDrop := xErr == nil && yErr == nil && r.URL.Query().Get("x") != "" && r.URL.Query().Get("y") != ""
			existing, err := b.detach(panel, dropX, dropY, hasDrop)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":       true,
				"panel":    panel,
				"existing": existing,
			})
		case "/api/attach":
			panel := r.URL.Query().Get("panel")
			if !b.attach(panel) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "panel": panel})
		case "/api/window/panel":
			panel := r.URL.Query().Get("panel")
			action := r.URL.Query().Get("action")
			if !b.panelAction(panel, action) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		case "/api/window/action":
			if !b.windowAction(r.URL.Query().Get("action")) {
				http.Error(w, "unknown action", http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/minimize":
			b.main.Minimise()
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/maximize":
			b.windowAction("maximize")
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/fullscreen":
			b.windowAction("fullscreen")
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/close":
			go b.quit()
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/state":
			writeJSON(w, http.StatusOK, map[string]any{
				"maximised":  b.main.IsMaximised(),
				"fullscreen": b.main.IsFullscreen(),
			})
		case "/api/state":
			detached, attached := b.state()
			writeJSON(w, http.StatusOK, map[string]any{
				"detached": detached,
				"attached": attached,
			})
		case "/api/dock-preview":
			b.mu.Lock()
			active := b.previewPanel != ""
			panel := b.previewPanel
			title := b.previewTitle
			b.mu.Unlock()
			writeJSON(w, http.StatusOK, map[string]any{
				"active": active,
				"panel":  panel,
				"title":  title,
			})
		case "/api/update":
			latest, releaseURL, err := fetchLatestReleaseFromPage()
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":     true,
				"latest": latest,
				"url":    releaseURL,
			})
		case "/api/ack":
			b.acknowledge(r.URL.Query().Get("panel"))
			w.WriteHeader(http.StatusNoContent)
		case "/api/github":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			var payload struct {
				Method      string `json:"method"`
				URL         string `json:"url"`
				Body        string `json:"body"`
				ContentType string `json:"contentType"`
				Token       string `json:"token"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 4*1024*1024)).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			status, body, err := githubProxy(payload.Method, payload.URL, payload.Body, payload.ContentType, payload.Token)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"status": status, "body": body})
		case "/api/open-external":
			if err := openExternal(r.URL.Query().Get("url")); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			static.ServeHTTP(w, r)
		}
	})
}

func legacyVersion(name string) [3]int {
	var version [3]int
	parts := regexp.MustCompile(`([0-9]+)\.([0-9]+)\.([0-9]+)`).FindStringSubmatch(name)
	if len(parts) == 4 {
		version[0], _ = strconv.Atoi(parts[1])
		version[1], _ = strconv.Atoi(parts[2])
		version[2], _ = strconv.Atoi(parts[3])
	}
	return version
}

func copyDirectory(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		input, err := os.Open(source)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.Create(destination)
		if err != nil {
			return err
		}
		defer output.Close()
		_, err = io.Copy(output, input)
		return err
	}
	if err := os.MkdirAll(destination, info.Mode().Perm()); err != nil {
		return err
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := copyDirectory(
			filepath.Join(source, entry.Name()),
			filepath.Join(destination, entry.Name()),
		); err != nil {
			return err
		}
	}
	return nil
}

// stableWebviewDataPath keeps WebView2 localStorage (login token, layout,
// events) under one version-independent directory. The Wails default is
// %APPDATA%\[BinaryName.exe], so every renamed release would otherwise look
// like a fresh install and drop the user's session.
func stableWebviewDataPath() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		base = os.Getenv("APPDATA")
	}
	if base == "" {
		return ""
	}
	stable := filepath.Join(base, "LanshanMoments")
	if info, err := os.Stat(stable); err == nil && info.IsDir() {
		entries, _ := os.ReadDir(stable)
		if len(entries) > 0 {
			return stable
		}
		// An empty directory can be left by an interrupted first launch.
		_ = os.Remove(stable)
	}

	candidates := make([]string, 0, 4)
	for _, pattern := range []string{"lanshan*", "Lanshan*"} {
		matches, _ := filepath.Glob(filepath.Join(base, pattern))
		candidates = append(candidates, matches...)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		leftVersion := legacyVersion(filepath.Base(candidates[i]))
		rightVersion := legacyVersion(filepath.Base(candidates[j]))
		for index := 0; index < 3; index++ {
			if leftVersion[index] != rightVersion[index] {
				return leftVersion[index] > rightVersion[index]
			}
		}
		left, leftErr := os.Stat(candidates[i])
		right, rightErr := os.Stat(candidates[j])
		if leftErr != nil {
			return false
		}
		if rightErr != nil {
			return true
		}
		return left.ModTime().After(right.ModTime())
	})
	for _, candidate := range candidates {
		if strings.EqualFold(candidate, stable) {
			continue
		}
		info, err := os.Stat(candidate)
		if err != nil || !info.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(candidate, "EBWebView")); err != nil {
			continue
		}
		if err := os.Rename(candidate, stable); err == nil {
			return stable
		}
		// The old app may still hold a WebView2 lock. Copying preserves the
		// session when a rename is not possible.
		if err := copyDirectory(candidate, stable); err == nil {
			return stable
		}
		_ = os.RemoveAll(stable)
	}

	_ = os.MkdirAll(stable, 0o755)
	return stable
}

func main() {
	bridge := &windowBridge{
		detached: map[string]*panelWindow{},
		attached: map[string]bool{},
		last:     map[string]bounds{},
	}
	static := application.AssetFileServerFS(assets)
	app := application.New(application.Options{
		Name: "阑珊时刻",
		Windows: application.WindowsOptions{
			WebviewUserDataPath: stableWebviewDataPath(),
		},
		Assets: application.AssetOptions{
			Handler: bridge.handler(static),
		},
	})
	bridge.app = app
	bridge.main = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "阑珊时刻",
		Width:            1440,
		Height:           900,
		MinWidth:         980,
		MinHeight:        700,
		Frameless:        true,
		BackgroundColour: application.NewRGB(10, 10, 10),
		URL:              "/",
	})
	bridge.main.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		go bridge.quit()
	})
	go func() {
		time.Sleep(700 * time.Millisecond)
		bridge.fitMainToScreen()
	}()
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
