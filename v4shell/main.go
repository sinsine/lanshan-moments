package main

import (
	"embed"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist
var assets embed.FS

type windowBridge struct {
	app      *application.App
	main     *application.WebviewWindow
	mu       sync.Mutex
	detached map[string]*application.WebviewWindow
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
}

func (b *windowBridge) attach(panel string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if window, ok := b.detached[panel]; ok {
		window.Close()
		delete(b.detached, panel)
	}
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
		default:
			static.ServeHTTP(w, r)
		}
	})
}

func main() {
	bridge := &windowBridge{detached: map[string]*application.WebviewWindow{}}
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
