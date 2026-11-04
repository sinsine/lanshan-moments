package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name: "阑珊时刻",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "阑珊时刻", Width: 1440, Height: 900,
		MinWidth: 980, MinHeight: 700, Frameless: true,
		BackgroundColour: application.NewRGB(10, 10, 10), URL: "/",
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "week", Title: "周概览", Width: 640, Height: 720,
		X: 980, Y: 100, Frameless: true,
		BackgroundColour: application.NewRGB(18, 18, 18), URL: "/?panel=week",
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
