package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/session"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func main() {
	root := flag.String("root", ".", "repository root")
	listen := flag.String("listen", "127.0.0.1:8083", "loopback address")
	moodURL := flag.String("mood-url", "http://127.0.0.1:8000", "local mood service URL")
	flag.Parse()
	if !strings.HasPrefix(*listen, "127.0.0.1:") && !strings.HasPrefix(*listen, "[::1]:") {
		log.Fatal("listening app must bind to loopback")
	}
	if err := session.ValidateMoodURL(*moodURL); err != nil {
		log.Fatal(err)
	}
	catalog, err := taste.LoadCatalog(*root)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	store, err := session.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	server := &http.Server{Addr: *listen, Handler: session.Server{Catalog: catalog, Store: store, MoodURL: *moodURL}.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	log.Printf("listening API ready at http://%s", *listen)
	log.Fatal(server.ListenAndServe())
}
