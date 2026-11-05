package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:dist
var assets embed.FS

type windowBridge struct {
	app      *application.App
	main     *application.WebviewWindow
	mu       sync.Mutex
	detached map[string]*application.WebviewWindow
	attached map[string]bool
}

func (b *windowBridge) detach(panel string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if existing, ok := b.detached[panel]; ok {
		existing.Show()
		existing.Focus()
		return
	}
	window := b.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "panel-" + panel,
		Title:            "阑珊时刻 · " + panel,
		Width:            620,
		Height:           720,
		X:                940,
		Y:                80,
		MinWidth:         360,
		MinHeight:        320,
		Frameless:        true,
		BackgroundColour: application.NewRGB(10, 10, 10),
		URL:              "/?panel=" + panel,
	})
	b.detached[panel] = window

	// Bring the panel back when the independent window is moved over the main
	// window. The main webview polls /api/state and restores the tile.
	window.OnWindowEvent(events.Common.WindowDidMove, func(*application.WindowEvent) {
		mx, my := b.main.Position()
		mw, mh := b.main.Size()
		x, y := window.Position()
		ww, wh := window.Size()
		if x+ww/2 > mx && x+ww/2 < mx+mw && y+wh/2 > my && y+wh/2 < my+mh {
			b.mu.Lock()
			b.attached[panel] = true
			b.mu.Unlock()
			window.Close()
		}
	})
}

func (b *windowBridge) attach(panel string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if window, ok := b.detached[panel]; ok {
		window.Close()
		delete(b.detached, panel)
	}
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

func (b *windowBridge) handler(static http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"native":true,"windows":true}`))
		case "/api/detach":
			b.detach(r.URL.Query().Get("panel"))
			w.WriteHeader(http.StatusNoContent)
		case "/api/attach":
			b.attach(r.URL.Query().Get("panel"))
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/minimize":
			b.main.Minimise()
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/maximize":
			if b.main.IsMaximised() {
				b.main.Restore()
			} else {
				b.main.Maximise()
			}
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/close":
			b.main.Close()
			w.WriteHeader(http.StatusNoContent)
		case "/api/window/state":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"maximised": b.main.IsMaximised()})
		case "/api/state":
			b.mu.Lock()
			detached := make([]string, 0, len(b.detached))
			for id := range b.detached {
				detached = append(detached, id)
			}
			attached := make([]string, 0, len(b.attached))
			for id := range b.attached {
				attached = append(attached, id)
			}
			b.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"detached": detached, "attached": attached})
		case "/api/ack":
			b.mu.Lock()
			delete(b.attached, r.URL.Query().Get("panel"))
			b.mu.Unlock()
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
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "body": body})
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

func main() {
	bridge := &windowBridge{
		detached: map[string]*application.WebviewWindow{},
		attached: map[string]bool{},
	}
	static := application.AssetFileServerFS(assets)
	app := application.New(application.Options{
		Name: "阑珊时刻",
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
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}


