package client

import (
	"encoding/json"
	"log"
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

func (op operationAuctionGetOffersResponse) Process(state *albionState) {
	log.Println("[Market] Got response to AuctionGetOffers operation...")

	if !state.IsValidLocation() {
		log.Println("[Market] Warning: State location is invalid, skipping.")
		return
	}

	var orders []*lib.MarketOrder

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
		orders = append(orders, order)

		// Извлекаем данные
		auctionType, _ := rawOrder["AuctionType"].(string)
		priceFloat, _ := rawOrder["UnitPriceSilver"].(float64)
		itemId, _ := rawOrder["ItemTypeId"].(string)
		qualityFloat, _ := rawOrder["QualityLevel"].(float64)
		enchantFloat, _ := rawOrder["EnchantmentLevel"].(float64)

		// Финальная проверка: если город всё ещё пустой, пропускаем, чтобы не засорять таблицу мусором
		if order.LocationID == "" {
			log.Printf("[Market] Warning: LocationID is still empty for Item=%s, Type=%s. Skipping.", itemId, auctionType)
			continue
		}

		localData := LocalMarketData{
			ItemID:      itemId,
			LocationID:  order.LocationID,
			AuctionType: auctionType,
			Price:       int(priceFloat),
			Quality:     int(qualityFloat),
			Enchantment: int(enchantFloat),
			Timestamp:   time.Now().Format("2006.01.02 15"),
		}

		// Логируем успешный парсинг (ты увидишь это в консоли Go)
		log.Printf("[Market] Parsed: Item=%s, Loc=%s, Type=%s, Price=%d", itemId, order.LocationID, auctionType, int(priceFloat))

		SendToLocalElectron(localData)
	}

	if len(orders) > 0 {
		dashboard.SetEncryptionStatus(dashboard.EncryptionClear)
	}
}