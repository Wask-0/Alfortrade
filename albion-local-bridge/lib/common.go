package lib

import (
	"encoding/json"
	"os"
	"strconv"
	"sync"
)

// --- ТИПЫ ДЛЯ ЗАГРУЗКИ СЛОВАРЕЙ ---

type RawDumpItem struct {
	Index      string `json:"Index"`
	UniqueName string `json:"UniqueName"`
}

var (
	idToKey map[int]string
	loadOnce sync.Once
	loadErr error
)

func LoadMappings(dumpPath string, dictPath string) error {
	loadOnce.Do(func() {
		idToKey = make(map[int]string)
		
		dumpData, err := os.ReadFile(dumpPath)
		if err != nil {
			loadErr = err
			return
		}

		var rawItems []RawDumpItem
		if err := json.Unmarshal(dumpData, &rawItems); err != nil {
			loadErr = err
			return
		}

		for _, item := range rawItems {
			if item.UniqueName != "" && item.Index != "" {
				numID, err := strconv.Atoi(item.Index)
				if err == nil {
					idToKey[numID] = item.UniqueName
				}
			}
		}
	})
	return loadErr
}

func GetItemKeyByID(albionID int) (string, bool) {
	key, ok := idToKey[albionID]
	return key, ok
}

// --- БАЗОВЫЕ ТИПЫ (Обязательны для market.go и skills.go) ---

// CharacterID представляет идентификатор персонажа в формате UUID
type CharacterID string

// PrivateUpload используется для персонализированных данных
type PrivateUpload struct {
	CharacterId   CharacterID `json:"CharacterId"`
	CharacterName string      `json:"CharacterName"`
}

func (p *PrivateUpload) Personalize(id CharacterID, name string) {
	p.CharacterId = id
	p.CharacterName = name
}

// PersonalizedUpload интерфейс для uploads
type PersonalizedUpload interface {
	Personalize(CharacterID, string)
}