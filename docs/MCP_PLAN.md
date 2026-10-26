# Akilimo API MCP Agent Plan

This document outlines the design and implementation plan for a Model Context Protocol (MCP) agent that interfaces with the Akilimo API.

## 1. Agent Objectives
The MCP agent will serve as an intelligent bridge between a Large Language Model (LLM) and the Akilimo API. It will be hosted at `https://akilimo-mcp.akilimo.org`.

The agent will enable the LLM to:
- Retrieve agricultural reference data.
- Orchestrate the complex data collection required for agricultural recommendations.
- Manage computation history and user feedback.

## 2. Tool Definitions
The agent will expose the following tools to the LLM.

| Tool Name | Description | API Endpoint | Auth Required |
| :--- | :--- | :--- | :--- |
| `get_reference_data` | Fetches public data (countries, currencies, fertilizers, crop prices, etc.) | `GET /v1/{category}` | No |
| `compute_recommendations` | Submits detailed farm data to receive agricultural recommendations | `POST /v1/recommendations/compute` | Recommended |
| `get_recommendation_history` | Retrieves a paginated list of previous computations | `GET /v1/recommendations` | Yes |
| `submit_feedback` | Submits user feedback for a specific recommendation | `POST /v1/user-feedback` | Yes |
| `get_translations` | Fetches supported translations for the API | `GET /v1/translations` | Yes |

### Payload Specification: `compute_recommendations`
The agent will enforce a schema based on `ComputeRequestData`, requiring:
- **Farm Information**: `countryCode`, `useCase`, `fieldSize`, `areaUnit`.
- **Crop Data**: Specifics for Cassava, Maize, and Sweet Potato.
- **Cost Data**: Tractor, Manual, and Weeding costs.
- **Methodology**: Ploughing, Harrowing, and Ridging methods.
- **Investment**: `maxInvestment` limit.

## 3. Resource Definitions
The agent will expose static or semi-static data as MCP Resources for efficient context loading:
- `akilimo://countries`: List of all supported countries.
- `akilimo://currencies`: Supported currencies and their codes.
- `akilimo://available-fertilizers`: Global list of fertilizer identifiers.

## 4. Prompting Strategy
Because the `compute_recommendations` tool requires a large amount of specific data, the agent will use a specialized prompt:

**`guide_recommendation_request`**: 
This prompt instructs the LLM to behave as an agricultural consultant. Instead of asking for all data at once, it will:
1. Identify the user's country and crop of interest.
2. Query `get_reference_data` to find available fertilizers and prices for that region.
3. Iteratively interview the user to fill the `ComputeRequestData` schema.
4. Only call `compute_recommendations` once all mandatory fields are satisfied.

## 5. Implementation Roadmap

### Phase 1: Foundation
- [ ] Initialize Node.js project with `@modelcontextprotocol/sdk`.
- [ ] Implement `BaseApiClient` to handle request/response cycles.
- [ ] Implement API key management via environment variables (`AKILIMO_API_KEY`).
- [ ] Implement error mapping for `RecommendationException`.

### Phase 2: Tool & Resource Implementation
- [ ] Develop `get_reference_data` tool with category-based routing.
- [ ] Develop `compute_recommendations` tool with JSON schema validation.
- [ ] Develop `get_recommendation_history` and `submit_feedback` tools.
- [ ] Register the three primary MCP Resources.

### Phase 3: Optimization & Testing
- [ ] Create the `guide_recommendation_request` prompt.
- [ ] Test tool chains using the MCP Inspector.
- [ ] Validate payload mapping against the Laravel API requirements.

## 6. Authentication Strategy
The agent will utilize a long-lived API Key (`X-Api-Key`) provided via environment variables. This key will be injected into the headers of every request to the API.
