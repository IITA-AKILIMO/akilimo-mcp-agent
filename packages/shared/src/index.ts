import { z } from 'zod/v4';

// Mirrors POST /v1/recommendations/compute in the Akilimo API (new-akilimo-api:
// app/Rules/ComputeFieldRules.php, FertilizerRules.php, UserInfoRules.php and app/Data/*Data.php).
// Section keys are camelCase, field names are snake_case. Defaults follow what the AKILIMO
// mobile app sends, since the R compute service fails on values it cannot look up (nulls,
// yield 0, unknown produce types) even when the API's validation accepts them.

const money = z.number().min(0);

export const AREA_UNITS = ['acre', 'ha', 'm2', 'are'] as const;

export const FarmInformationSchema = z.object({
    country_code: z.string().length(2).describe('ISO 2-letter country code, e.g. NG, TZ, RW'),
    use_case: z.string().max(10).default('FR').describe('Akilimo use case code: FR = fertilizer recommendation, PP = planting practices, SPHS = scheduled planting and harvest, IC = intercropping. Set the matching flags under recommendations (and interCropping for IC)'),
    map_lat: z.number().min(-90).max(90),
    map_long: z.number().min(-180).max(180),
    field_size: z.number().min(1),
    area_unit: z.enum(AREA_UNITS),
});

export const InterCroppingSchema = z.object({
    inter_cropped_crop: z.string().max(255).nullable().default('NA').describe("Intercrop for IC: 'maize' in Nigeria, 'potato' (sweet potato) in Tanzania; other countries are not supported"),
    inter_cropping_maize_rec: z.boolean().default(false).describe('IC in Nigeria: set true to get maize intercropping advice'),
    inter_cropping_potato_rec: z.boolean().default(false).describe('IC in Tanzania: set true to get sweet potato intercropping advice'),
});

export const RecommendationSettingsSchema = z.object({
    lang: z.string().length(2).default('en'),
    fertilizer_rec: z.boolean().default(true).describe('FR: fertilizer recommendation (needs fertilizer_list). Set false for the other types'),
    planting_practices_rec: z.boolean().default(false).describe('PP: ploughing and ridging advice compared with the current practice'),
    scheduled_planting_rec: z.boolean().default(false).describe('SPHS: best planting date; use together with scheduled_harvest_rec'),
    scheduled_harvest_rec: z.boolean().default(false).describe('SPHS: best harvest date; use together with scheduled_planting_rec'),
});

export const PlantingSchema = z.object({
    planting_date: z.string().describe('YYYY-MM-DD'),
    harvest_date: z.string().describe('YYYY-MM-DD'),
    planting_date_window: z.number().int().min(0).default(1),
    harvest_date_window: z.number().int().min(0).default(1),
});

export const FallowSchema = z.object({
    fallow_type: z.string().max(50).default('none'),
    fallow_height: z.number().min(0).default(0),
    fallow_green: z.boolean().default(false),
});

export const TractorCostsSchema = z.object({
    tractor_plough: z.boolean().default(false),
    tractor_harrow: z.boolean().default(false),
    tractor_ridger: z.boolean().default(false),
    cost_lmo_area_basis: z.string().max(50).default('areaUnit'),
    cost_tractor_ploughing: money.default(0),
    cost_tractor_harrowing: money.default(0),
    cost_tractor_ridging: money.default(0),
});

export const ManualCostsSchema = z.object({
    cost_manual_ploughing: money.default(0),
    cost_manual_harrowing: money.default(0),
    cost_manual_ridging: money.default(0),
});

export const WeedingCostsSchema = z.object({
    cost_weeding_one: money.default(0),
    cost_weeding_two: money.default(0),
});

export const OperationsDoneSchema = z.object({
    ploughing_done: z.boolean().default(false),
    harrowing_done: z.boolean().default(false),
    ridging_done: z.boolean().default(false),
});

export const FarmMethodsSchema = z.object({
    method_ploughing: z.string().max(255).nullable().default('NA'),
    method_harrowing: z.string().max(255).nullable().default('NA'),
    method_ridging: z.string().max(255).nullable().default('NA'),
    method_weeding: z.string().max(255).nullable().default('NA'),
});

export const YieldInfoSchema = z.object({
    current_field_yield: z.number().min(0).default(11.25)
        .describe('Current cassava yield class in t/ha as used by the AKILIMO app, e.g. 3.75, 11.25, 18.75, 26.25, 33.75'),
    current_maize_performance: z.number().min(0).default(0),
    sell_to_starch_factory: z.boolean().default(false),
    starch_factory_name: z.string().max(255).nullable().default('NA'),
});

// The API's DTOs read unit_price_maize1 etc. (no underscore before the digit); its validation
// rules name them unit_price_maize_1, which the DTOs ignore
const cropPriceFields = {
    unit_price_maize1: money.default(0),
    unit_price_maize2: money.default(0),
    unit_price_potato1: money.default(0),
    unit_price_potato2: money.default(0),
};

const cropDataSchema = (defaultProduceType: string) => z.object({
    produce_type: z.string().max(50).default(defaultProduceType),
    unit_weight: z.number().min(0).default(0),
    unit_price: money.default(0),
    ...cropPriceFields,
});

// Fertilizer recommendations optimise against the cassava root price, so it is required
const CassavaSchema = z.object({
    produce_type: z.string().max(50).default('roots'),
    unit_weight: z.number().min(1).default(1000).describe('Weight in kg of the unit the price refers to'),
    unit_price: money.describe('Price per unit of cassava roots in local currency. Use a band\'s average_price from get_reference_data cassava-prices; the exact_price row holds -1 placeholders'),
    ...cropPriceFields,
});

export const ComputeFieldsSchema = z.object({
    farmInformation: FarmInformationSchema,
    interCropping: InterCroppingSchema.prefault({}),
    recommendations: RecommendationSettingsSchema.prefault({}),
    planting: PlantingSchema,
    fallow: FallowSchema.prefault({}),
    tractorCosts: TractorCostsSchema.prefault({}),
    manualCosts: ManualCostsSchema.prefault({}),
    weedingCosts: WeedingCostsSchema.prefault({}),
    operationsDone: OperationsDoneSchema.prefault({}),
    methods: FarmMethodsSchema.prefault({}),
    yieldInfo: YieldInfoSchema.prefault({}),
    cassava: CassavaSchema,
    maize: cropDataSchema('grain').prefault({}),
    sweetPotato: cropDataSchema('tubers').prefault({}),
    maxInvestment: money.default(0),
});

export const FertilizerSchema = z.object({
    key: z.string().describe('fertilizer_key from GET /v1/fertilizers, e.g. urea'),
    name: z.string(),
    fertilizer_type: z.string().describe('e.g. STRAIGHT or COMPOUND'),
    weight: z.number().min(0).describe('Bag weight in kg'),
    price: money.describe('Price per bag in local currency'),
    selected: z.boolean(),
});

export const UserInfoSchema = z.object({
    device_token: z.uuid(),
    risk_attitude: z.number(),
    user_name: z.string().max(255),
    first_name: z.string().max(255),
    last_name: z.string().max(255),
    gender: z.enum(['M', 'F']),
    phone_number: z.string().nullable().optional(),
    email_address: z.email().nullable().optional(),
    farm_name: z.string().max(255).nullable().optional(),
    send_sms: z.boolean().optional(),
    send_email: z.boolean().optional(),
});

export const ComputeRequestSchema = z.object({
    user_info: UserInfoSchema,
    compute_request: ComputeFieldsSchema,
    fertilizer_list: z.array(FertilizerSchema).default([]),
});

export type ComputeRequest = z.infer<typeof ComputeRequestSchema>;
export type ComputeRequestInput = z.input<typeof ComputeRequestSchema>;

// Activity logged by the web client while talking to MCP servers
export interface MCPEvent {
  id: string;
  timestamp: Date;
  type: 'connection' | 'tool_call' | 'tool_response' | 'error';
  server: string; // MCP server id, e.g. akilimo-1.0
  message: string;
  payload?: unknown;
}

export * from './chat.js';
export * from './countries.js';
export * from './geo.js';
