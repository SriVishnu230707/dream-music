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
	type sessionStore interface {
		session.Store
		Close() error
		PurgeExpired(context.Context) error
	}
	var store sessionStore
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		pgStore, err := session.Open(ctx, dsn)
		cancel()
		if err != nil {
			log.Printf("PostgreSQL connection failed (%v); using in-memory store", err)
			store = session.NewMemoryStore()
		} else {
			store = pgStore
		}
	} else {
		log.Printf("DATABASE_URL not set; running with in-memory session store")
		store = session.NewMemoryStore()
	}
	defer store.Close()
	// PostgreSQL cascades remove each expired session's feedback and check-ins.
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			if err := store.PurgeExpired(ctx); err != nil {
				log.Printf("expired-session purge: %v", err)
			}
			cancel()
		}
	}()
	server := &http.Server{Addr: *listen, Handler: session.Server{Catalog: catalog, Store: store, MoodURL: *moodURL}.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	log.Printf("listening API ready at http://%s", *listen)
	log.Fatal(server.ListenAndServe())
}
