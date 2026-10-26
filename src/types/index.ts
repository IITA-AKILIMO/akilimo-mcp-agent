import { z } from 'zod';

export const FarmInformationSchema = z.object({
    countryCode: z.string().length(2),
    useCase: z.string(),
    mapLat: z.string().optional(),
    mapLong: z.string().optional(),
    fieldSize: z.number(),
    areaUnit: z.string(),
});

export const InterCroppingSchema = z.object({
    interCroppedCrop: z.string().optional(),
    interCroppingMaizeRec: z.boolean().optional(),
    interCroppingPotatoRec: z.boolean().optional(),
});

export const RecommendationSettingsSchema = z.object({
    lang: z.string().default('en'),
    fertilizerRec: z.boolean().default(true),
    plantingPracticesRec: z.boolean().default(true),
    scheduledPlantingRec: z.boolean().default(true),
    scheduledHarvestRec: z.boolean().default(true),
});

export const PlantingSchema = z.object({
    plantingDate: z.string(), // YYYY-MM-DD
    plantingDateWindow: z.number().optional(),
    harvestDate: z.string(), // YYYY-MM-DD
    harvestDateWindow: z.number().optional(),
});

export const FallowSchema = z.object({
    fallowType: z.string().optional(),
    fallowHeight: z.number().optional(),
    fallowGreen: z.boolean().optional(),
});

export const TractorCostsSchema = z.object({
    tractorPlough: z.boolean(),
    tractorHarrow: z.boolean(),
    tractorRidger: z.boolean(),
    costLmoAreaBasis: z.number(),
    costTractorPloughing: z.number(),
    costTractorHarrowing: z.number(),
    costTractorRidging: z.number(),
});

export const ManualCostsSchema = z.object({
    costManualPloughing: z.number(),
    costManualHarrowing: z.number(),
    costManualRidging: z.number(),
});

export const WeedingCostsSchema = z.object({
    costWeedingOne: z.number(),
    costWeedingTwo: z.number(),
});

export const OperationsDoneSchema = z.object({
    ploughingDone: z.boolean(),
    harrowingDone: z.boolean(),
    ridgingDone: z.boolean(),
});

export const FarmMethodsSchema = z.object({
    methodPloughing: z.string(),
    methodHarrowing: z.string(),
    methodRidging: z.string(),
    methodWeeding: z.string(),
});

export const YieldInfoSchema = z.object({
    currentFieldYield: z.number(),
    currentMaizePerformance: z.number(),
    sellToStarchFactory: z.boolean(),
    starchFactoryName: z.string().optional(),
});

export const CropDataSchema = z.object({
    produceType: z.string(),
    unitWeight: z.number(),
    unitPrice: z.number(),
});

export const ComputeRequestSchema = z.object({
    farmInformation: FarmInformationSchema,
    interCropping: InterCroppingSchema,
    recommendations: RecommendationSettingsSchema,
    planting: PlantingSchema,
    fallow: FallowSchema,
    tractorCosts: TractorCostsSchema,
    manualCosts: ManualCostsSchema,
    weedingCosts: WeedingCostsSchema,
    operationsDone: OperationsDoneSchema,
    methods: FarmMethodsSchema,
    yieldInfo: YieldInfoSchema,
    cassava: CropDataSchema,
    maize: CropDataSchema,
    sweetPotato: CropDataSchema,
    maxInvestment: z.number(),
});

export type ComputeRequest = z.infer<typeof ComputeRequestSchema>;
