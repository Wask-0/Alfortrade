package client

import (
	"math"
	"time"

	"github.com/ao-data/albiondata-client/lib"
	"github.com/ao-data/albiondata-client/log"
)

type operationAuctionGetItemAverageStats struct {
	ItemID      int32         `mapstructure:"1"`
	Quality     uint8         `mapstructure:"2"`
	Timescale   lib.Timescale `mapstructure:"3"`
	Enchantment uint32        `mapstructure:"4"`
	MessageID   uint64        `mapstructure:"255"`
}

func (op operationAuctionGetItemAverageStats) Process(state *albionState) {
	var index = op.MessageID % CacheSize

	// Исправление для отрицательных ID (особенность протокола Albion)
	var itemId = op.ItemID
	if itemId < 0 && itemId > -129 {
		itemId = itemId + 256
	}

	mhInfo := marketHistoryInfo{
		albionId:  itemId,
		timescale: op.Timescale,
		quality:   op.Quality,
		enchantment: op.Enchantment,
	}

	state.marketHistoryIDLookup[index] = mhInfo
	log.Debugf("Market History - Caching %d at %d.", mhInfo.albionId, index)
}

type operationAuctionGetItemAverageStatsResponse struct {
	ItemAmounts   []int64  `mapstructure:"0"`
	SilverAmounts []uint64 `mapstructure:"1"`
	Timestamps    []uint64 `mapstructure:"2"`
	MessageID     int      `mapstructure:"255"`
}

func (op operationAuctionGetItemAverageStatsResponse) Process(state *albionState) {
	var index = op.MessageID % CacheSize

	// Ждем коррелирующий запрос, если он еще не обработан
	waits := 0
	for waits < 30 {
		if state.marketHistoryIDLookup[index].albionId < 1 {
			time.Sleep(1 * time.Second)
			waits += 1
		} else {
			break
		}
	}

	if state.marketHistoryIDLookup[index].albionId < 1 {
		log.Warnf("Market History - Market history at index %d is invalid.", index)
		return
	}

	var mhInfo = state.marketHistoryIDLookup[index]
	state.marketHistoryIDLookup[index].albionId = 0 // Очищаем кэш

	if !state.IsValidLocation() {
		return
	}

	var histories []*lib.MarketHistory
	var totalSales int64
	var minTs uint64 = math.MaxUint64
	var maxTs uint64 = 0

	for i := range op.ItemAmounts {
		amount := op.ItemAmounts[i]
		
		// Обработка отрицательных значений количества
		if amount < 0 {
			if amount < -124 {
				continue
			}
			amount = 256 + amount
		}

		history := &lib.MarketHistory{}
		history.ItemAmount = amount
		history.SilverAmount = op.SilverAmounts[i]
		history.Timestamp = op.Timestamps[i]
		histories = append(histories, history)
		
		totalSales += amount

		// Ищем минимальное и максимальное время для расчета периода
		if op.Timestamps[i] < minTs {
			minTs = op.Timestamps[i]
		}
		if op.Timestamps[i] > maxTs {
			maxTs = op.Timestamps[i]
		}
	}

	if len(histories) < 1 {
		return
	}

	// --- РАСЧЕТ ПРОДАЖ В ДЕНЬ ---
	var salesPerDay int
	diff := maxTs - minTs

	if diff > 0 {
		var durationDays float64

		// Определяем длительность периода по известным значениям Diff
		switch diff {
		case 864000000000:      // 1 день
			durationDays = 1.0
		case 6048000000000:     // 7 дней
			durationDays = 7.0
		case 24192000000000:    // 28 дней
			durationDays = 28.0
		default:
			// Если пришло что-то другое, пробуем вычислить примерно (на случай новых таймскейлов)
			// 864000000000 / 1 = 864e9
			durationDays = float64(diff) / 864_000_000_000.0
		}

		if durationDays > 0 {
			salesPerDay = int(float64(totalSales) / durationDays)
		} else {
			salesPerDay = int(totalSales)
		}
	} else {
		salesPerDay = int(totalSales)
	}

	itemKey, found := lib.GetItemKeyByID(int(mhInfo.albionId))
	
	if !found {
		// Если предмета нет в дампах, мы не сможем показать его в таблице корректно
		log.Debugf("Item ID %d not found in items.json dump", mhInfo.albionId)
		return 
	}

	log.Infof("[History] CALCULATION: ItemID=%d, TotalSales=%d, Diff=%.0f, DurationDays=%.2f, ResultSPD=%d", 
		mhInfo.albionId, totalSales, diff, diff/10_000_000, salesPerDay)

	
	// --- ОТПРАВКА ДАННЫХ В ELECTRON ---
	localData := LocalMarketData{
		ItemID:      itemKey, // Строковый ID, например "T8_MAIN_SWORD_CRYSTAL@4"
		LocationID:  state.LocationId,
		SalesPerDay: salesPerDay,
		Timestamp:   time.Now().Format("2006.01.02 15"),
		// Quality и Enchantment можно добавить, если они нужны для фильтрации на фронтенде
		Quality:     int(mhInfo.quality),
		Enchantment: int(mhInfo.enchantment),
	}

	SendToLocalElectron(localData)
	log.Infof("[History] Sent SalesPerDay=%d for Item=%s (%s)", salesPerDay, itemKey, state.LocationId)
}