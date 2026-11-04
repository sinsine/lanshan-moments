package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the native-side bridge for the Windows shell.
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Version is exposed to the web UI as a small native health check.
func (a *App) Version() string {
	return "0.3.0"
}

// HTTPResponse is the small envelope returned to the WebView.
type HTTPResponse struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
}

// GitHubRequest makes GitHub HTTP calls from Go so the WebView is not blocked
// by CORS. It is deliberately restricted to GitHub hosts and GET/POST.
func (a *App) GitHubRequest(method, rawURL, body, contentType, token string) (*HTTPResponse, error) {
	upper := strings.ToUpper(strings.TrimSpace(method))
	if upper != http.MethodGet && upper != http.MethodPost {
		return nil, fmt.Errorf("unsupported method: %s", method)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported URL")
	}
	if parsed.Host != "github.com" && parsed.Host != "api.github.com" {
		return nil, fmt.Errorf("GitHub host required")
	}

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(upper, rawURL, reader)
	if err != nil {
		return nil, err
	}
	if contentType == "" {
		contentType = "application/json"
	}
	request.Header.Set("Content-Type", contentType)
	if parsed.Host == "api.github.com" {
		request.Header.Set("Accept", "application/vnd.github+json")
		request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	} else {
		request.Header.Set("Accept", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, 2*1024*1024)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	return &HTTPResponse{Status: response.StatusCode, Body: string(data)}, nil
}

// Quit closes the native window from the app menu.
func (a *App) Quit() {
	wailsruntime.Quit(a.ctx)
}

// OpenExternal opens GitHub's authorization page in the system browser.
func (a *App) OpenExternal(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" {
		return fmt.Errorf("unsupported URL")
	}
	wailsruntime.BrowserOpenURL(a.ctx, rawURL)
	return nil
}




