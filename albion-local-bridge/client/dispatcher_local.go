package client

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
)

// Маппинг LocationId -> Название города
var locationNameMap = map[string]string{
	"3003":           "Black Market",
	"3005":           "Caerleon",
	"2004":           "Bridgewatch",
	"1002":           "Lymhurst",
	"4002":           "Fort Sterling",
	"0007":           "Thetford",
	"3008":           "Martlock",
	"5003":           "Brecilien",
	"BLACKBANK-0001": "Black Market",
}

// GetLocationName преобразует LocationId в читаемое название
func GetLocationName(locationId string) string {
	if name, ok := locationNameMap[locationId]; ok {
		return name
	}

	// Проверяем специальные суффиксы
	if len(locationId) > 0 {
		if containsAny(locationId, []string{"-HellDen", "-Auction2"}) {
			return "Special Location"
		}
	}

	return "Неизвестная локация"
}

func containsAny(s string, substrs []string) bool {
	for _, substr := range substrs {
		if len(s) >= len(substr) && s[len(s)-len(substr):] == substr {
			return true
		}
	}
	return false
}

// LocalMarketData - единый формат данных для отправки в Electron
type LocalMarketData struct {
	ItemID      string `json:"itemId"`
	LocationID  string `json:"locationId"`
	AuctionType string `json:"auctionType"` // "offer" (продажа) или "request" (покупка)
	Price       int    `json:"price"`       // UnitPriceSilver
	Quality     int    `json:"quality"`
	Enchantment int    `json:"enchantment"`
	SalesPerDay int    `json:"salesPerDay"`
	Timestamp   string `json:"timestamp"`
	IsMyOrder   bool   `json:"isMyOrder"`
	OrderId     int    `json:"orderId"`
	Amount      int    `json:"amount"` 
}

func SendMyOrderToElectron(data LocalMarketData) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("[LocalBridge] Ошибка маршалинга: %v", err)
		return
	}
	resp, err := http.Post("http://127.0.0.1:3000/my-order-update", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return
	}
	defer resp.Body.Close()
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

// MyOrder - структура твоего личного ордера
type MyOrder struct {
	OrderID     int    `json:"orderId"`
	ItemID      string `json:"itemId"`
	Amount      int    `json:"amount"`
	Price       int    `json:"price"`
	LocationID  string `json:"locationId"`
	AuctionType string `json:"auctionType"` // "offer" (продажа) или "request" (покупка)
	Sold        int    `json:"sold"`        // Сколько уже выполнено
	Expires     string `json:"expires"`
}

// SendMyOrdersUpdate отправляет список твоих ордеров на фронтенд
func SendMyOrdersUpdate(orders []MyOrder) {
	jsonData, err := json.Marshal(orders)
	if err != nil {
		log.Printf("[LocalBridge] Ошибка маршалинга ордеров: %v", err)
		return
	}
	// Отправляем на новый топик my-orders-update
	resp, err := http.Post("http://127.0.0.1:3000/my-orders-update", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return
	}
	defer resp.Body.Close()
}