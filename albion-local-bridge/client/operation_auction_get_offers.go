package client

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ao-data/albiondata-client/internal/dashboard"
	"github.com/ao-data/albiondata-client/lib"
)

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДЛЯ СЧЕТЧИКА И ДЕБАУНСА ===
type orderCounterState struct {
	count    int
	lastSeen time.Time
}

var (
	sentOrdersCounter = make(map[string]*orderCounterState)
	packetDebounce    = make(map[string]time.Time) // Ключ пакета -> время последней обработки
	counterMutex      sync.Mutex
	ORDER_TTL         = 3 * time.Minute
	MAX_PER_ITEM      = 10
)

// === СТРУКТУРЫ ОПЕРАЦИЙ ===
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

type parsedOrder struct {
	raw         map[string]interface{}
	order       *lib.MarketOrder
	auctionType string
	price       int
	itemId      string
	locationId  string
	salesPerDay int
	orderId     int
	amount      int 
}

// === ОСНОВНАЯ ЛОГИКА ОБРАБОТКИ ===
func (op operationAuctionGetOffersResponse) Process(albionState *albionState) {
	log.Println("[Market] Got response to AuctionGetOffers operation...")

	if !albionState.IsValidLocation() {
		log.Println("[Market] Warning: State location is invalid, skipping.")
		return
	}

	var allParsed []parsedOrder

	for _, v := range op.MarketOrders {
		var rawOrder map[string]interface{}
		if err := json.Unmarshal([]byte(v), &rawOrder); err != nil {
			continue
		}

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

		if order.LocationID == "" {
			order.LocationID = albionState.LocationId
		}

		auctionType, _ := rawOrder["AuctionType"].(string)
		priceFloat, _ := rawOrder["UnitPriceSilver"].(float64)
		itemId, _ := rawOrder["ItemTypeId"].(string)
		idFloat, _ := rawOrder["Id"].(float64)
		amountFloat, _ := rawOrder["Amount"].(float64)

		spdFloat, _ := rawOrder["SalesPerDay"].(float64)
		salesPerDay := int(spdFloat)

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
			orderId:     int(idFloat),
			amount:      int(amountFloat),
		})
	}

	if len(allParsed) > 0 {
		dashboard.SetEncryptionStatus(dashboard.EncryptionClear)
	}

	// Разделение и сортировка
	var offers []parsedOrder
	var requests []parsedOrder

	for _, p := range allParsed {
		if p.auctionType == "offer" {
			offers = append(offers, p)
		} else if p.auctionType == "request" {
			requests = append(requests, p)
		}
	}

	sort.Slice(offers, func(i, j int) bool {
		return offers[i].price < offers[j].price
	})

	sort.Slice(requests, func(i, j int) bool {
		return requests[i].price > requests[j].price
	})

	now := time.Now()
	myCharId := fmt.Sprintf("%s", albionState.CharacterId)

	// === ДЕБАУНС ПАКЕТА ===
	// Создаем хеш содержимого пакета, чтобы понять, дубликат это или нет
	packetHash := fmt.Sprintf("offers_%d_requests_%d_loc_%s", len(offers), len(requests), albionState.LocationId)
	
	counterMutex.Lock()
	if lastTime, exists := packetDebounce[packetHash]; exists {
		if now.Sub(lastTime) < ORDER_TTL {
			counterMutex.Unlock()
			log.Printf("[Market] Duplicate packet ignored (hash: %s)", packetHash)
			return // Игнорируем дубликат пакета целиком
		}
	}
	packetDebounce[packetHash] = now
	counterMutex.Unlock()
	// ==================

	log.Printf("[Market] Processing %d offers and %d requests", len(offers), len(requests))

	sendParsedOrders := func(list []parsedOrder) {
		for _, p := range list {
			key := fmt.Sprintf("%s_%s_%s_%d", p.itemId, p.locationId, p.auctionType, p.orderId)

			counterMutex.Lock()
			cs, exists := sentOrdersCounter[key]
			if exists && now.Sub(cs.lastSeen) > ORDER_TTL {
				delete(sentOrdersCounter, key)
				exists = false
			}
			if !exists {
				cs = &orderCounterState{count: 0, lastSeen: now}
				sentOrdersCounter[key] = cs
			} else {
				cs.lastSeen = now
				if cs.count > 0 {
					counterMutex.Unlock()
					continue
				}
			}
			counterMutex.Unlock()

			isMyOrder := false


			localData := LocalMarketData{
				ItemID:      p.itemId,
				LocationID:  p.locationId,
				AuctionType: p.auctionType,
				Price:       p.price,
				Quality:     int(p.raw["QualityLevel"].(float64)),
				Enchantment: int(p.raw["EnchantmentLevel"].(float64)),
				SalesPerDay: p.salesPerDay,
				Timestamp:   now.Format("2006.01.02 15"),
				IsMyOrder:   isMyOrder,
				OrderId:     p.orderId,
				Amount:      p.amount,
				
			}

			if p.auctionType == "offer" {
				if sellerCharId, ok := p.raw["SellerCharacterId"].(string); ok {
					if sellerCharId == myCharId {
						isMyOrder = true
					}
				}
			} else if p.auctionType == "request" {
				if buyerCharId, ok := p.raw["BuyerCharacterId"].(string); ok {
					if buyerCharId == myCharId {
						isMyOrder = true
					}
				}
			}			

			// === РАЗДЕЛЕНИЕ ПОТОКОВ ===
			if isMyOrder {
				log.Printf("[MY ORDER] Sending to /my-order-update: Item=%s, Price=%d", p.itemId, p.price)
				SendMyOrderToElectron(localData) // Отдельный эндпоинт
			} else {
				SendToLocalElectron(localData)   // Обычный рынок
			}

			counterMutex.Lock()
			sentOrdersCounter[key].count = 1
			counterMutex.Unlock()
		}
	}

	sendParsedOrders(offers)
	sendParsedOrders(requests)
}