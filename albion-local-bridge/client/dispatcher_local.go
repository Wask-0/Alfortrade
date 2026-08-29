package client

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
)

// LocalMarketData - единый формат данных для отправки в Electron
type LocalMarketData struct {
	ItemID      string `json:"itemId"`
	LocationID  string `json:"locationId"`
	AuctionType string `json:"auctionType"` // "offer" (продажа) или "request" (покупка)
	Price       int    `json:"price"`       // UnitPriceSilver
	Quality     int    `json:"quality"`
	Enchantment int    `json:"enchantment"`
	Timestamp   string `json:"timestamp"`
}

// SendToLocalElectron отправляет данные на локальный порт 3000
func SendToLocalElectron(data LocalMarketData) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("[LocalBridge] Ошибка маршалинга: %v", err)
		return
	}

	resp, err := http.Post("http://127.0.0.1:3000/market-update", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		// Тихо игнорируем ошибки, если Electron приложение закрыто
		return
	}
	defer resp.Body.Close()
}