package client

import (
	"github.com/ao-data/albiondata-client/lib"
)

type operationJoinResponse struct {
	CharacterID   lib.CharacterID `mapstructure:"1"`
	CharacterName string          `mapstructure:"2"`
	Location      string          `mapstructure:"8"`
	GuildID       lib.CharacterID `mapstructure:"56"`
	GuildName     string          `mapstructure:"58"`
}

//CharacterPartsJSON string          `mapstructure:"6"`
//Edition            string          `mapstructure:"38"`

func (op operationJoinResponse) Process(state *albionState) {

	// Reset the AODataServerID here. This leads to a fresh execution
	// of SetServerID() incase the player switched servers
	state.AODataServerID = 0

	location := normalizeLocationID(op.Location)
if location != "" {
    state.LocationId = location
    UpdateCurrentLocation(location)  // <-- ДОБАВЛЕННАЯ СТРОКА
}

	if state.CharacterId != op.CharacterID {
	}
	state.CharacterId = op.CharacterID

	if state.CharacterName != op.CharacterName {
	}
	state.CharacterName = op.CharacterName
}
