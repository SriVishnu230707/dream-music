package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func TestCandidateHTTPValidationAndSuccess(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	server := handler(catalog)
	post := func(body, contentType string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/v1/candidates", strings.NewReader(body))
		request.Header.Set("Content-Type", contentType)
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	if response := post(`{"userId":"u","strategy":"taste","limit":3,"preferredGenres":["ambient"]}`, "application/json"); response.Code != 200 || !strings.Contains(response.Body.String(), `"candidates"`) {
		t.Fatalf("valid request failed: %d %s", response.Code, response.Body.String())
	}
	if response := post(`{"userId":"u","strategy":"taste","limit":3,"unknown":1}`, "application/json"); response.Code != 400 {
		t.Fatal("unknown JSON field accepted")
	}
	if response := post(`{"userId":"u","strategy":"taste","limit":3}{}`, "application/json"); response.Code != 400 {
		t.Fatal("trailing JSON accepted")
	}
	if response := post(strings.Repeat("x", 70000), "application/json"); response.Code != 400 {
		t.Fatal("oversized body accepted")
	}
	if response := post(`{}`, "text/plain"); response.Code != 415 {
		t.Fatal("wrong content type accepted")
	}
}
