package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func handler(catalog taste.Catalog) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "catalogId": catalog.ID, "tracks": catalog.Count()})
	})
	mux.HandleFunc("POST /v1/candidates", func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaErr != nil || mediaType != "application/json" {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var request taste.Request
		if err := decoder.Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid candidate request"})
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trailing JSON or oversized request"})
			return
		}
		response, err := taste.Rank(catalog, request)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		if err := catalog.ValidateCandidates(response.Candidates); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "candidate audio unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, response)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func main() {
	root := flag.String("root", ".", "repository root")
	listen := flag.String("listen", "127.0.0.1:8081", "local listen address")
	flag.Parse()
	if !strings.HasPrefix(*listen, "127.0.0.1:") && !strings.HasPrefix(*listen, "[::1]:") {
		fmt.Fprintln(os.Stderr, "Phase 3 API must bind to loopback until authentication is implemented")
		os.Exit(2)
	}
	catalog, err := taste.LoadCatalog(*root)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *listen, Handler: handler(catalog), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	log.Printf("taste API listening on %s with %d playable tracks", *listen, catalog.Count())
	log.Fatal(server.ListenAndServe())
}
