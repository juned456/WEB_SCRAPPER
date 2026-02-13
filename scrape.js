// scrape.js
const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.screener.in/screens/3285703/techno-funda-screener/";

async function scrape() {
  try {
    const { data: html } = await axios.get(URL, {
      headers: {
        // pretend to be a normal browser
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);

    const stocks = [];

    // Screener tables generally look like: <table><tbody><tr><td>S.No</td><td>Name</td>...</tr>
    $("table tbody tr").each((i, row) => {
      const tds = $(row).find("td");
      if (tds.length === 0) return; // skip weird rows

      const sNo = $(tds[0]).text().trim();
      const name = $(tds[1]).text().trim(); // 2nd column = stock name
      const cmp = $(tds[2]).text().trim(); // 3rd column = CMP (optional)

      if (name) {
        stocks.push({ sNo, name, cmp });
      }
    });

    console.log("Total stocks found:", stocks.length);
    console.table(stocks); // Node will print a nice table in console
  } catch (err) {
    console.error("Error while scraping:", err.message);
  }
}

scrape();
