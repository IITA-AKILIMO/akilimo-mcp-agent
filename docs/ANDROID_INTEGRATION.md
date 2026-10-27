# Using the AKILIMO MCP server from the AKILIMO Android app

**IITA Internal Use**

This guide is for the team that maintains the AKILIMO Android app. It explains what the Akilimo 1.0 MCP server offers, how an Android app talks to it, and what to watch for. The code samples are Kotlin and are meant as a starting point: they were written for this guide and have **not** been compiled or run on a device. The protocol facts in section 2 were checked against a running server.

## 1. When MCP helps, and when it does not

The MCP server wraps the Akilimo 1.0 API (`https://api.akilimo.org`) in four tools. For the app that means:

- **Compact reference data.** `get_fertilizer_options` and `get_cassava_price` return a country's fertilizers, price bands and a typical price in about 3 KB, instead of the 28 KB the raw endpoints return. The typical prices are what the app can pre-fill.
- **One call for the recommendation.** `compute_recommendations` takes the same request the API takes and fills in defaults that the R compute service needs (for example `use_case` `FR`, `"NA"` instead of null).
- **A path to AI features.** The same tool list can be handed to a language model, so a chat or voice assistant in the app can use the tools without custom code per question.

If the app only needs to show prices and request a recommendation, calling the REST API directly is also fine, and nothing here requires you to change that. Choose MCP when you want the compact views, the same behaviour as the web interface, or an AI assistant later.

## 2. How the server speaks (checked against a running server)

| Item | Value |
| :--- | :--- |
| Production endpoint | `https://akilimo-mcp.akilimo.org/mcp` (Caddy exposes only `/mcp`, `/sse`, `/messages` and `/health`) |
| Local development | `http://<host>:3001/mcp` (`pnpm dev:server:http`); from the Android emulator the host machine is `10.0.2.2` |
| Transport | MCP "streamable HTTP", **stateless**: every request is a `POST` of one JSON-RPC message |
| Required header | `Accept: application/json, text/event-stream`. Without it the server answers `406 Not Acceptable` |
| Session / `initialize` | Not needed. A `tools/call` sent on its own works. (Sending `initialize` first is allowed and harmless.) |
| Response framing | Even a single answer arrives as one server-sent event: `event: message` then `data: {JSON-RPC response}`. A parser has to read the `data:` line |
| Authentication | None on the Akilimo 1.0 endpoint. Nothing in the app needs a key |
| CORS | Irrelevant for a native app; it only affects browsers |
| Slow calls | `compute_recommendations` can take tens of seconds. Use a read timeout of about 120 s |

JSON-RPC request:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"get_cassava_price","arguments":{"countryCode":"NG"}}}
```

Response (wrapped in `event: message` / `data:` lines):

```json
{"result":{"content":[{"type":"text","text":"{ ...tool result as a JSON string... }"}]},"jsonrpc":"2.0","id":1}
```

The tool's own answer is **a JSON string inside `content[0].text`**, so it has to be parsed a second time. When a tool fails, `result.isError` is `true` and the text is the error message. Protocol problems come back as a JSON-RPC `error` object instead of `result`.

Quick check from any machine:

```bash
curl -s https://akilimo-mcp.akilimo.org/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 3. The tools

Country codes are the five AKILIMO countries as ISO 2-letter codes: `NG`, `TZ`, `RW`, `GH`, `BI`.

### `get_cassava_price`

Arguments: `{"countryCode": "NG"}`. Returns:

```json
{
  "country": "NG", "currency": "NGN", "unit": "tonne (1000 kg) of fresh roots",
  "price_bands": [{"min": 5000, "max": 8000, "average": 6500}],
  "typical_price_per_tonne": 15000
}
```

`price_bands` can be empty and `typical_price_per_tonne` `null` for a country without published prices (Rwanda at the time of writing). The app must let the farmer type a price in that case.

### `get_fertilizer_options`

Arguments: `{"countryCode": "NG"}`. Returns the fertilizers on sale in the country:

```json
{
  "country": "NG", "currency": "NGN",
  "fertilizers": [{
    "key": "NPK_15_15_15_NG", "name": "NPK 15:15:15", "fertilizer_type": "NPK_15_15_15",
    "bag_weight_kg": 50, "price_bands_per_bag": [15201.08, 18898.64],
    "typical_price_per_bag": 18898.64
  }]
}
```

### `compute_recommendations`

Arguments (only the fields the app needs; the server fills the rest with the defaults the mobile app has always sent):

```json
{
  "compute_request": {
    "farmInformation": {
      "country_code": "NG", "use_case": "FR",
      "map_lat": 7.38, "map_long": 3.9,
      "field_size": 1, "area_unit": "acre"
    },
    "planting": { "planting_date": "2026-11-27", "harvest_date": "2027-09-27" },
    "cassava": { "unit_price": 15000, "unit_weight": 1000 },
    "recommendations": { "lang": "en" }
  },
  "fertilizer_list": [{
    "key": "NPK_15_15_15_NG", "name": "NPK 15:15:15", "fertilizer_type": "NPK_15_15_15",
    "weight": 50, "price": 18898.64, "selected": true
  }]
}
```

Rules:

- `area_unit` is one of `acre`, `ha`, `m2`, `are`. Dates are `YYYY-MM-DD`, the harvest after the planting.
- `cassava.unit_price` is the price **per tonne** with `unit_weight` `1000`.
- `fertilizer_list` holds **every** fertilizer from `get_fertilizer_options` with a price per bag; set `selected` to `true` only for those the farmer can buy.
- Round coordinates to 4 decimals (about 11 m); that is plenty for a field.

A real answer (inside `content[0].text`, parsed):

```json
{
  "request_id": "0da630d3-f971-47ff-953d-f35a7730c1ae",
  "status": "success",
  "version": "20251228",
  "data": {
    "rec_type": "FR",
    "recommendation": "Fertilizer application does not increase your revenue therefore it is not recommended for your field.",
    "data": [{ "lat": 7.38, "lon": 3.9, "plDate": 330, "N": 0, "P": 0, "K": 0,
               "WLY": 17.0243, "CurrentY": 5.6073, "TargetY": 5.6073, "TC": 0, "NR": 0 }],
    "fertilizer_rates": []
  }
}
```

Show `data.recommendation` to the farmer as the headline. When the location is outside the area AKILIMO serves, the text says so and `data` and `fertilizer_rates` are empty; the app should suggest checking the field location. `fertilizer_rates` lists the amounts per fertilizer when a recommendation exists; it was empty in this example, so check its exact fields against a response for a recommended field before you build the screen.

## 4. Three ways to connect from Android

| Option | Use it when | Notes |
| :--- | :--- | :--- |
| **A. Plain HTTPS client (recommended)** | The app calls known tools from its own screens | OkHttp (or Retrofit) plus kotlinx.serialization. Small, no extra dependency, full control over timeouts. Section 5 |
| **B. Kotlin MCP SDK** | You want generic tool discovery, for example to feed an AI model | `io.modelcontextprotocol:kotlin-sdk-client` offers `StreamableHttpClientTransport`. Its README lists JVM, Native, JS and Wasm targets and does not mention Android, so check that it runs on your minimum API level before committing to it |
| **C. Through your own backend** | The app must not call IITA servers directly, or you need caching and rate limiting | The backend calls the MCP server and exposes whatever fits the app |

## 5. Option A in Kotlin

Dependencies (Gradle, versions as in your project):

```kotlin
implementation("com.squareup.okhttp3:okhttp:<version>")
implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:<version>")
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:<version>")
// plugin: org.jetbrains.kotlin.plugin.serialization
```

`AndroidManifest.xml` needs `<uses-permission android:name="android.permission.INTERNET" />`.

A small client that sends one tool call and returns the parsed tool answer:

```kotlin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class McpException(message: String) : Exception(message)

class AkilimoMcpClient(
    private val url: String = "https://akilimo-mcp.akilimo.org/mcp",
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS) // compute_recommendations is slow
        .build(),
) {
    private val ids = AtomicInteger()
    val json = Json { ignoreUnknownKeys = true }

    suspend fun callTool(name: String, arguments: JsonObject): JsonElement = withContext(Dispatchers.IO) {
        val payload = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", ids.incrementAndGet())
            put("method", "tools/call")
            putJsonObject("params") {
                put("name", name)
                put("arguments", arguments)
            }
        }
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json, text/event-stream") // required, otherwise HTTP 406
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw McpException("HTTP ${response.code}: ${body.take(200)}")

            // The answer is one server-sent event ("data: {...}"); plain JSON is accepted too
            val data = body.lineSequence().firstOrNull { it.startsWith("data:") }?.removePrefix("data:")?.trim() ?: body
            val message = json.parseToJsonElement(data).jsonObject

            message["error"]?.let { throw McpException(it.jsonObject["message"]?.jsonPrimitive?.content ?: "MCP error") }
            val result = message["result"]?.jsonObject ?: throw McpException("Empty answer")
            val text = result["content"]?.jsonArray?.firstOrNull()?.jsonObject?.get("text")?.jsonPrimitive?.content.orEmpty()
            if (result["isError"]?.jsonPrimitive?.booleanOrNull == true) throw McpException(text.ifBlank { "$name failed" })

            json.parseToJsonElement(text) // the tool's answer is JSON inside a string
        }
    }
}
```

Typed results for the two reference tools:

```kotlin
@Serializable
data class CassavaPrice(
    val country: String,
    val currency: String? = null,
    @SerialName("price_bands") val priceBands: List<PriceBand> = emptyList(),
    @SerialName("typical_price_per_tonne") val typicalPricePerTonne: Double? = null,
)
@Serializable data class PriceBand(val min: Double, val max: Double, val average: Double)

@Serializable
data class FertilizerOptions(val country: String, val currency: String? = null, val fertilizers: List<FertilizerOption> = emptyList())
@Serializable
data class FertilizerOption(
    val key: String,
    val name: String,
    @SerialName("fertilizer_type") val fertilizerType: String,
    @SerialName("bag_weight_kg") val bagWeightKg: Double,
    @SerialName("typical_price_per_bag") val typicalPricePerBag: Double? = null,
)

suspend fun AkilimoMcpClient.cassavaPrice(country: String): CassavaPrice =
    json.decodeFromJsonElement(callTool("get_cassava_price", buildJsonObject { put("countryCode", country) }))

suspend fun AkilimoMcpClient.fertilizerOptions(country: String): FertilizerOptions =
    json.decodeFromJsonElement(callTool("get_fertilizer_options", buildJsonObject { put("countryCode", country) }))
```

The recommendation request, built from what the app already collects:

```kotlin
suspend fun AkilimoMcpClient.recommend(
    country: String, lat: Double, lon: Double,
    fieldSize: Double, areaUnit: String,          // "acre" | "ha" | "m2" | "are"
    plantingDate: String, harvestDate: String,    // "YYYY-MM-DD"
    rootPricePerTonne: Double,
    fertilizers: List<Triple<FertilizerOption, Double, Boolean>>, // option, price per bag, can buy
): JsonElement = callTool("compute_recommendations", buildJsonObject {
    putJsonObject("compute_request") {
        putJsonObject("farmInformation") {
            put("country_code", country); put("use_case", "FR")
            put("map_lat", Math.round(lat * 10_000) / 10_000.0)
            put("map_long", Math.round(lon * 10_000) / 10_000.0)
            put("field_size", fieldSize); put("area_unit", areaUnit)
        }
        putJsonObject("planting") { put("planting_date", plantingDate); put("harvest_date", harvestDate) }
        putJsonObject("cassava") { put("unit_price", rootPricePerTonne); put("unit_weight", 1000) }
        putJsonObject("recommendations") { put("lang", "en") }
    }
    putJsonArray("fertilizer_list") {
        fertilizers.forEach { (f, price, selected) ->
            addJsonObject {
                put("key", f.key); put("name", f.name); put("fertilizer_type", f.fertilizerType)
                put("weight", f.bagWeightKg); put("price", price); put("selected", selected)
            }
        }
    }
})
```

Using it from a `ViewModel`:

```kotlin
viewModelScope.launch {
    _state.value = Loading
    _state.value = try {
        val options = mcp.fertilizerOptions("NG")
        val price = mcp.cassavaPrice("NG")
        Ready(options, price.typicalPricePerTonne)   // pre-fill the form with the typical prices
    } catch (e: Exception) {
        Failed(e.message ?: "Could not load prices")
    }
}
```

Practical points:

- **Slow compute.** Show progress and keep the call alive across screen rotation (a `ViewModel` scope). For a request that must survive the app being closed, run it in a `WorkManager` job and store the answer.
- **Cancellation.** `execute()` blocks the IO thread; to cancel a running call when the user leaves, keep the `Call` and call `cancel()`, or use `enqueue` with `suspendCancellableCoroutine`.
- **Cache the reference data.** Fertilizers and price bands change rarely. Store the last answer per country (Room or DataStore) with a timestamp, show it immediately, and refresh in the background, so the form still opens with weak coverage. A recommendation itself always needs a connection.
- **Java projects.** The same flow works with `OkHttpClient` and a JSON library of your choice: POST the JSON-RPC body, read the `data:` line, parse `result.content[0].text` a second time.

## 6. An AI assistant in the app (optional, later)

The web interface's chat runs on the server (`/chat`), but that endpoint is built for the browser: it needs a signed-in session cookie and uses provider keys held by IITA. It is **not** meant to be called from the app as it is. If the app should get a chat or voice assistant, there are two safe ways:

1. **The app's own AI backend** calls a model, takes the tool list from `tools/list` on this MCP server, and runs `tools/call` on behalf of the model. The model key stays on that backend.
2. **A mobile-friendly chat endpoint** on this server (token-based instead of cookie-based, with per-user limits). It does not exist yet; ask the MCP maintainers if you want it.

Never put an AI provider key, or the Akilimo 2.0 partner key, inside the APK: anything in an APK can be extracted.

## 7. Security, privacy and operations

- **HTTPS only** in production. Android 9 and later block cleartext traffic by default; for local testing against `http://10.0.2.2:3001/mcp` allow cleartext only in a debug `network_security_config.xml`, never in the release build.
- **No secrets in the app.** The Akilimo 1.0 endpoint needs none, which is why it is safe to call from a phone. This also means anyone can call it. There is no rate limiting on the server today, so before a public rollout add limits at the reverse proxy (Caddy) in the `proxy-tool` stack.
- **Location is personal data.** `compute_recommendations` receives the field coordinates. Keep the app's existing consent and privacy text accurate, send 4-decimal coordinates at most, and do not log request bodies.
- **Errors for farmers.** Map `McpException` messages to plain language. Typical causes: no network, timeout, the AKILIMO API unreachable (`[Akilimo API 503]`), or a location outside the recommendation area (a normal, successful answer with an explanatory `recommendation`).
- **Versioning.** The tool names and arguments above are stable today. Read the tool list at start-up or in a health check if you want the app to notice a change early.

## 8. Test checklist

1. `curl` the production `tools/list` (section 2) and confirm four tools come back.
2. Fetch fertilizers and the cassava price for each of `NG`, `TZ`, `RW`, `GH`, `BI`; confirm the form handles a country with no cassava price.
3. Request a recommendation for a field inside the area (for example near Ibadan, `7.38, 3.9`) and for a point outside it; confirm both screens read sensibly.
4. Switch the phone to airplane mode: cached reference data still opens, the recommendation shows a clear "no connection" message.
5. Run a request on a slow network and confirm the 120 s timeout and the progress state behave.
6. Rotate the screen during a request and confirm it neither restarts nor crashes.

## 9. Questions for the mobile team

- Is the app Kotlin, Java or a cross-platform framework? The samples assume native Kotlin.
- Does the app already call `api.akilimo.org` directly? If so, which screens would use the MCP tools instead, and which keep the REST calls?
- Which Android API level is the minimum? (Relevant for option B.)
- Should the offline cache reuse the bundled reference data the app ships with?
