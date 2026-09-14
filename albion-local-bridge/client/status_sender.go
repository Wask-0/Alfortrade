package client

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

type BackendStatus struct {
	Running         bool   `json:"running"`
	Encrypted       bool   `json:"encrypted"`
	CurrentLocation string `json:"currentLocation"`
}

// Глобальная переменная для хранения текущей локации
var (
	currentLocation string
	locationMutex   sync.RWMutex
)

// UpdateCurrentLocation обновляет текущую локацию игрока
func UpdateCurrentLocation(locationId string) {
	locationMutex.Lock()
	defer locationMutex.Unlock()

	if locationId == "" {
		currentLocation = "Неизвестная локация"
	} else {
		currentLocation = GetLocationName(locationId)
	}

	log.Printf("[Location] Текущая локация: %s (ID: %s)", currentLocation, locationId)
}

// GetCurrentLocation возвращает текущую локацию
func GetCurrentLocation() string {
	locationMutex.RLock()
	defer locationMutex.RUnlock()
	return currentLocation
}

func SendStatus(status BackendStatus) {
	jsonData, err := json.Marshal(status)
	if err != nil {
		return
	}

	resp, err := http.Post("http://127.0.0.1:3000/status", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return
	}
	defer resp.Body.Close()
}

// Запускаем фоновую отправку статуса каждые 5 секунд
func StartStatusSender() {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			SendStatus(BackendStatus{
				Running:         true,
				Encrypted:       false,
				CurrentLocation: GetCurrentLocation(),
			})
		}
	}()
}