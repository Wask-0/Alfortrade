package client

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

type BackendStatus struct {
	Running   bool `json:"running"`
	Encrypted bool `json:"encrypted"`
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
				Running:   true,
				Encrypted: false, // Здесь будет реальное значение из dashboard
			})
		}
	}()
}