package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/jchv/go-webview2"

	"imagiflydesk/internal/app"
	"imagiflydesk/internal/imagiapi"
)

//go:embed web
var webBundle embed.FS

const version = "1.2.24"

func main() {
	enableDPIAwareness()
	app.CleanupInstallers()

	selftest := flag.Bool("selftest", false, "run live API checks and exit")
	headless := flag.Bool("headless", false, "serve the local UI without opening a window")
	useBrowser := flag.Bool("browser", false, "open the UI in Edge app mode instead of WebView2")
	demo := flag.Bool("demo", false, "serve fixture data for UI preview (no login required)")
	flag.Parse()

	cfg := app.LoadConfig()
	api := imagiapi.New()
	if *demo {
		// Demo mode is a pure preview: never read or touch the real saved
		// session, so "logout" or failed writes cannot affect the account.
		api.SetSession("")
	} else {
		api.SetSession(app.LoadActiveSession())
	}

	sub, err := fs.Sub(webBundle, "web")
	if err != nil {
		log.Fatal(err)
	}
	srv := app.NewServer(sub, cfg, api, version, *demo)
	base, err := srv.Listen()
	if err != nil {
		log.Fatal("无法启动本地服务: ", err)
	}

	if *selftest {
		fmt.Println("Imagifly Desktop", version, "API 自检 @", time.Now().Format("2006-01-02 15:04:05"))
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		checks := imagiapi.SelfTest(ctx)
		fmt.Print(imagiapi.Summary(checks))
		fail := 0
		for _, c := range checks {
			if !c.OK {
				fail++
			}
		}
		if fail > 0 {
			os.Exit(1)
		}
		return
	}

	if *headless {
		fmt.Println("local UI:", base)
		select {}
	}

	hideConsole()

	if !*useBrowser {
		runtime.LockOSThread()
		width, height := windowSize()
		opts := webview2.WebViewOptions{
			Debug:     false,
			AutoFocus: true,
			DataPath:  filepath.Join(mustConfigDir(), "webview2"),
			WindowOptions: webview2.WindowOptions{
				Title:  "Imagifly 桌面版",
				Width:  width,
				Height: height,
				Center: true,
			},
		}
		if w := webview2.NewWithOptions(opts); w != nil {
			defer w.Destroy()
			applyCustomWindowChrome(w.Window())
			setWindowChromeTheme(w.Window(), cfg.Theme == "dark")
			_ = w.Bind("nativeTheme", func(theme string) {
				setWindowChromeTheme(w.Window(), theme == "dark")
			})
			_ = w.Bind("winMinimize", func() {
				minimizeWindow(w.Window())
			})
			_ = w.Bind("winToggleMaximize", func() bool {
				return toggleMaximizeWindow(w.Window())
			})
			_ = w.Bind("winClose", func() {
				closeWindow(w.Window())
			})
			_ = w.Bind("winStartDrag", func() {
				startWindowDrag(w.Window())
			})
			_ = w.Bind("winStartResize", func(edge string) {
				startWindowResize(w.Window(), edge)
			})
			_ = w.Bind("winIsMaximized", func() bool {
				return isWindowMaximized(w.Window())
			})
			w.Navigate(base)
			w.Run()
			return
		}
		log.Println("WebView2 不可用，回退到 Edge 应用窗口")
	}

	launchBrowser(base)
	select {}
}

func mustConfigDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "."
	}
	return filepath.Join(dir, "ImagiflyDesktop")
}

func launchBrowser(url string) {
	paths := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "Application", "msedge.exe"),
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			cmd := exec.Command(p, "--app="+url, "--window-size=1440,920", "--no-first-run")
			_ = cmd.Start()
			return
		}
	}
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	rundll32 := filepath.Join(root, "System32", "rundll32.exe")
	_ = exec.Command(rundll32, "url.dll,FileProtocolHandler", url).Start()
}
