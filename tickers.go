package main

// Ticker описывает бумагу в «пузыре».
// Cap — примерная капитализация в млрд $ (используется только как вес плитки
// в treemap, поэтому точность тут не важна; живые данные — цена и % изменения).
type Ticker struct {
	Symbol string
	Group  string
	Cap    float64
}

var tickers = []Ticker{
	// Полупроводники — сердце пузыря
	{"NVDA", "chips", 4500},
	{"AVGO", "chips", 1600},
	{"TSM", "chips", 1500},
	{"AMD", "chips", 400},
	{"ASML", "chips", 400},
	{"MU", "chips", 260},
	{"INTC", "chips", 180},
	{"QCOM", "chips", 180},
	{"AMAT", "chips", 190},
	{"LRCX", "chips", 190},
	{"KLAC", "chips", 150},
	{"ARM", "chips", 160},
	{"TXN", "chips", 150},
	{"ADI", "chips", 120},
	{"MRVL", "chips", 75},
	{"SMCI", "chips", 25},

	// Мегакэпы и интернет
	{"AAPL", "megacaps", 4000},
	{"MSFT", "megacaps", 3700},
	{"GOOGL", "megacaps", 3400},
	{"AMZN", "megacaps", 2400},
	{"META", "megacaps", 1600},
	{"TSLA", "megacaps", 1400},
	{"NFLX", "megacaps", 470},
	{"UBER", "megacaps", 190},
	{"SHOP", "megacaps", 200},
	{"SPOT", "megacaps", 130},

	// Софт и облака
	{"ORCL", "software", 700},
	{"PLTR", "software", 420},
	{"SAP", "software", 300},
	{"CRM", "software", 230},
	{"NOW", "software", 180},
	{"APP", "software", 200},
	{"ADBE", "software", 140},
	{"PANW", "software", 140},
	{"CRWD", "software", 130},
	{"SNOW", "software", 85},
	{"NET", "software", 75},
	{"CDNS", "software", 90},
	{"SNPS", "software", 70},
	{"DDOG", "software", 55},
	{"COIN", "software", 80},

	// Железо, сети, датацентры
	{"CSCO", "hardware", 280},
	{"IBM", "hardware", 290},
	{"ANET", "hardware", 170},
	{"DELL", "hardware", 90},
	{"VRT", "hardware", 60},
	{"WDC", "hardware", 50},
	{"STX", "hardware", 50},
	{"HPE", "hardware", 30},
	{"CRWV", "hardware", 50},
	{"NBIS", "hardware", 25},
}
