package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/ao-data/albiondata-client/client"
	"github.com/ao-data/albiondata-client/internal/pcapdriver"
	"github.com/ao-data/albiondata-client/lib" 
)

var version = "1.0.0-local-bridge"

func main() {
	log.Println("===========================================")
	log.Println("  Albion Data Local Bridge (Market Only)")
	log.Println("  Отправка данных на http://127.0.0.1:3000")
	log.Println("  Нажмите Ctrl+C для завершения")
	log.Println("===========================================")

	log.Println("  Загрузка словарей предметов...")
	if err := lib.LoadMappings("items.json", "items-dictionary.json"); err != nil {
		log.Printf("⚠️ Ошибка загрузки словарей: %v. Некоторые функции могут работать некорректно.", err)
	} else {
		log.Println("  ✅ Словари успешно загружены.")
	}

	// Проверяем драйвер захвата пакетов (Npcap/WinPcap)
	w := pcapdriver.Check()
	if w.Message != "" {
		log.Printf("⚠️ ПРЕДУПРЕЖДЕНИЕ: %s", w.Message)
		if w.HelpURL != "" {
			log.Printf("   Помощь: %s", w.HelpURL)
		}
	}

	// Инициализируем клиент
	c := client.NewClient(version)

	// Запускаем перехват пакетов в отдельной горутине
	go func() {
		// 👇 ЭТА СТРОКА ЗАПУСКАЕТ ФОНОВУЮ ОТПРАВКУ СТАТУСА В ELECTRON
		client.StartStatusSender()

		err := c.Run()
		if err != nil {
			log.Printf("❌ Ошибка перехвата пакетов: %v", err)
			log.Println("Убедитесь, что программа запущена от имени Администратора и установлен Npcap.")
		}
	}()

	// Ждем сигнала завершения (Ctrl+C)
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("\n🛑 Завершение работы...")
}