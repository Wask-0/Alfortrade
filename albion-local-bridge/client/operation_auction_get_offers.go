package client

import (
	"encoding/json"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/ao-data/albiondata-client/internal/dashboard"
	"github.com/ao-data/albiondata-client/lib"
)

type operationAuctionGetOffers struct {
	Category         string   `mapstructure:"1"`
	SubCategory      string   `mapstructure:"2"`
	Quality          string   `mapstructure:"5"`
	Enchantment      uint32   `mapstructure:"6"`
	EnchantmentLevel string   `mapstructure:"10"`
	ItemIds          []uint16 `mapstructure:"8"`
	MaxResults       uint32   `mapstructure:"12"`
	IsAscendingOrder bool     `mapstructure:"14"`
}

func (op operationAuctionGetOffers) Process(state *albionState) {
	log.Println("[Market] Got AuctionGetOffers operation...")
	state.RecordMarketDataRequest(time.Now())
}

type operationAuctionGetOffersResponse struct {
	MarketOrders []string `mapstructure:"0"`
}

// Вспомогательная структура для сортировки
type parsedOrder struct {
	raw         map[string]interface{}
	order       *lib.MarketOrder
	auctionType string
	price       int
	itemId      string
	locationId  string
	salesPerDay int
}

func (op operationAuctionGetOffersResponse) Process(state *albionState) {
	log.Println("[Market] Got response to AuctionGetOffers operation...")

	if !state.IsValidLocation() {
		log.Println("[Market] Warning: State location is invalid, skipping.")
		return
	}

	var allParsed []parsedOrder

	for _, v := range op.MarketOrders {
		var rawOrder map[string]interface{}
		if err := json.Unmarshal([]byte(v), &rawOrder); err != nil {
			continue
		}

		// Фикс для Smugglers Den / Rest areas
		if loc, ok := rawOrder["LocationId"].(string); ok && strings.Contains(loc, "@") {
			rawOrder["LocationId"] = loc
			if newJson, err := json.Marshal(rawOrder); err == nil {
				v = string(newJson)
			}
		}

		order := &lib.MarketOrder{}
		if err := json.Unmarshal([]byte(v), order); err != nil {
			continue
		}

		// Если в пакете нет города, берем из текущего состояния персонажа
		if order.LocationID == "" {
			order.LocationID = state.LocationId
		}

		// Извлекаем данные
		auctionType, _ := rawOrder["AuctionType"].(string)
		priceFloat, _ := rawOrder["UnitPriceSilver"].(float64)
		itemId, _ := rawOrder["ItemTypeId"].(string)
		
		// Пытаемся вытащить SalesPerDay (если игра его присылает в этом пакете)
		spdFloat, _ := rawOrder["SalesPerDay"].(float64)
		salesPerDay := int(spdFloat)

		// Финальная проверка локации
		if order.LocationID == "" {
			log.Printf("[Market] Warning: LocationID is still empty for Item=%s, Type=%s. Skipping.", itemId, auctionType)
			continue
		}

		allParsed = append(allParsed, parsedOrder{
			raw:         rawOrder,
			order:       order,
			auctionType: auctionType,
			price:       int(priceFloat),
			itemId:      itemId,
			locationId:  order.LocationID,
			salesPerDay: salesPerDay,
		})
	}

	if len(allParsed) > 0 {
		dashboard.SetEncryptionStatus(dashboard.EncryptionClear)
	}

	// === РАЗДЕЛЕНИЕ И СОРТИРОВКА ===
	var offers []parsedOrder   // Продажа (offer)
	var requests []parsedOrder // Покупка (request)

	for _, p := range allParsed {
		if p.auctionType == "offer" {
			offers = append(offers, p)
		} else if p.auctionType == "request" {
			requests = append(requests, p)
		}
	}

	// Сортируем продажи: от дешевых к дорогим (берем минимум)
	sort.Slice(offers, func(i, j int) bool {
		return offers[i].price < offers[j].price
	})

	// Сортируем покупки: от дорогых к дешевым (берем максимум)
	sort.Slice(requests, func(i, j int) bool {
		return requests[i].price > requests[j].price
	})

	// Ограничиваем по 10 штук из каждой категории
	maxItems := 10
	if len(offers) > maxItems {
		offers = offers[:maxItems]
	}
	if len(requests) > maxItems {
		requests = requests[:maxItems]
	}

	log.Printf("[Market] Sending %d offers and %d requests (limited to top %d each)", len(offers), len(requests), maxItems)

	// Отправляем только лучшие ордера
	sendParsedOrders := func(list []parsedOrder) {
		for _, p := range list {
			localData := LocalMarketData{
				ItemID:      p.itemId,
				LocationID:  p.locationId,
				AuctionType: p.auctionType,
				Price:       p.price,
				Quality:     int(p.raw["QualityLevel"].(float64)),
				Enchantment: int(p.raw["EnchantmentLevel"].(float64)),
				SalesPerDay: p.salesPerDay,
				Timestamp:   time.Now().Format("2006.01.02 15"),
			}
			SendToLocalElectron(localData)
		}
	}

	sendParsedOrders(offers)
	sendParsedOrders(requests)
}