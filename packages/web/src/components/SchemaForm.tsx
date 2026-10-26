import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MapPicker } from './MapPicker';

// The subset of JSON Schema that MCP tool input schemas use in practice
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  description?: string;
  title?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
}

type Value = unknown;
type OnChange = (value: Value) => void;

// Collapses nullable unions (anyOf [{type: X}, {type: 'null'}]) to their single real type
const normalize = (schema: JsonSchema): JsonSchema => {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const nonNull = variants.filter(v => v.type !== 'null');
    if (nonNull.length === 1) {
      return { ...nonNull[0], description: schema.description ?? nonNull[0].description, default: schema.default ?? nonNull[0].default };
    }
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter(t => t !== 'null');
    if (types.length === 1) return { ...schema, type: types[0] };
  }
  return schema;
};

const humanize = (key: string) =>
  key.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

const isEmpty = (v: Value) =>
  v === undefined || v === '' || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

const withKey = (obj: Value, key: string, v: Value): Value => {
  const next: Record<string, Value> = { ...(obj as Record<string, Value> | undefined) };
  if (isEmpty(v)) delete next[key];
  else next[key] = v;
  return Object.keys(next).length ? next : undefined;
};

const defaultHint = (schema: JsonSchema) =>
  schema.default !== undefined && schema.default !== null ? `Default: ${String(schema.default)}` : undefined;

interface FieldProps {
  name: string;
  schema: JsonSchema;
  value: Value;
  onChange: OnChange;
  required?: boolean;
  path: string;
}

const Label: React.FC<{ htmlFor: string; name: string; required?: boolean }> = ({ htmlFor, name, required }) => (
  <label className="form-label small mb-1" htmlFor={htmlFor}>
    {humanize(name)}
    {required && <span className="text-danger ms-1" aria-label="required">*</span>}
  </label>
);

const Help: React.FC<{ schema: JsonSchema }> = ({ schema }) =>
  schema.description ? <div className="form-text mt-0">{schema.description}</div> : null;

const PrimitiveField: React.FC<FieldProps> = ({ name, schema, value, onChange, required, path }) => {
  const id = `field-${path}`;

  if (schema.enum) {
    return (
      <div>
        <Label htmlFor={id} name={name} required={required} />
        <select id={id} className="form-select form-select-sm" value={value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? undefined : schema.enum!.find(o => String(o) === e.target.value))}>
          <option value="">{required ? 'Select…' : (defaultHint(schema) ?? '—')}</option>
          {schema.enum.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </select>
        <Help schema={schema} />
      </div>
    );
  }

  if (schema.type === 'boolean') {
    const checked = (value ?? schema.default ?? false) as boolean;
    return (
      <div className="form-check form-switch mt-md-4">
        <input id={id} className="form-check-input" type="checkbox" role="switch" checked={checked}
          onChange={e => onChange(e.target.checked)} />
        <label className="form-check-label small" htmlFor={id}>{humanize(name)}</label>
        <Help schema={schema} />
      </div>
    );
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div>
        <Label htmlFor={id} name={name} required={required} />
        <input id={id} type="number" className="form-control form-control-sm"
          step={schema.type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum}
          placeholder={defaultHint(schema)} value={value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
        <Help schema={schema} />
      </div>
    );
  }

  const isDate = schema.format === 'date' || /YYYY-MM-DD/.test(schema.description ?? '');
  return (
    <div>
      <Label htmlFor={id} name={name} required={required} />
      <input id={id} type={isDate ? 'date' : 'text'} className="form-control form-control-sm"
        placeholder={defaultHint(schema)} value={value === undefined || value === null ? '' : String(value)}
        onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} />
      {!isDate && <Help schema={schema} />}
    </div>
  );
};

// Fallback for schemas the form cannot render (unions, maps, ...): edit the value as JSON
const JsonField: React.FC<FieldProps> = ({ name, schema, value, onChange, required, path }) => {
  const id = `field-${path}`;
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  return (
    <div>
      <Label htmlFor={id} name={name} required={required} />
      <textarea id={id} className={`form-control form-control-sm font-monospace ${invalid ? 'is-invalid' : ''}`} rows={3}
        value={text} placeholder="JSON value"
        onChange={e => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) { setInvalid(false); onChange(undefined); return; }
          try { onChange(JSON.parse(text)); setInvalid(false); } catch { setInvalid(true); }
        }} />
      <div className="invalid-feedback">Not valid JSON</div>
      <Help schema={schema} />
    </div>
  );
};

const ArrayField: React.FC<FieldProps> = ({ name, schema, value, onChange, required, path }) => {
  const items = (Array.isArray(value) ? value : []) as Value[];
  const itemSchema = normalize(schema.items ?? {});

  if (itemSchema.type !== 'object') {
    // Primitive arrays are entered as a comma-separated list
    const id = `field-${path}`;
    const toItem = (s: string) => (itemSchema.type === 'number' || itemSchema.type === 'integer' ? Number(s) : s);
    return (
      <div>
        <Label htmlFor={id} name={name} required={required} />
        <input id={id} className="form-control form-control-sm" placeholder="Comma-separated values"
          value={items.join(', ')}
          onChange={e => {
            const parts = e.target.value.split(',').map(s => s.trim()).filter(Boolean).map(toItem);
            onChange(parts.length ? parts : undefined);
          }} />
        <Help schema={schema} />
      </div>
    );
  }

  const set = (next: Value[]) => onChange(next.length ? next : undefined);
  return (
    <div>
      <div className="d-flex align-items-center mb-1">
        <span className="small">{humanize(name)}{required && <span className="text-danger ms-1">*</span>}</span>
        <button type="button" className="btn btn-sm btn-outline-secondary ms-auto d-inline-flex align-items-center gap-1"
          onClick={() => set([...items, {}])}>
          <Plus size={14} /> Add
        </button>
      </div>
      <Help schema={schema} />
      {items.length === 0 && <div className="small text-body-secondary fst-italic">No items</div>}
      <div className="d-flex flex-column gap-2 mt-1">
        {items.map((item, i) => (
          <div key={i} className="border rounded p-2 position-relative">
            <button type="button" className="btn btn-sm btn-link text-danger position-absolute top-0 end-0"
              aria-label={`Remove item ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
            <ObjectFields schema={itemSchema} value={item}
              onChange={v => set(items.map((old, j) => (j === i ? (v ?? {}) : old)))} path={`${path}-${i}`} />
          </div>
        ))}
      </div>
    </div>
  );
};

// A numeric latitude/longitude pair in one object gets a map picker
const isNumeric = (s?: JsonSchema) => !!s && ['number', 'integer'].includes(normalize(s).type as string);
const findCoordinateKeys = (properties: Record<string, JsonSchema>) => {
  const keys = Object.keys(properties);
  const lat = keys.find(k => /(^|_)lat(itude)?$/i.test(k) && isNumeric(properties[k]));
  const lon = keys.find(k => /(^|_)(lon|long|lng|longitude)$/i.test(k) && isNumeric(properties[k]));
  return lat && lon ? { lat, lon } : null;
};

const ObjectFields: React.FC<{ schema: JsonSchema; value: Value; onChange: OnChange; path: string }> = ({ schema, value, onChange, path }) => {
  const entries = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const obj = (value ?? {}) as Record<string, Value>;
  const coords = findCoordinateKeys(schema.properties ?? {});

  return (
    <div className="row g-2">
      {coords && (
        <div className="col-12">
          <MapPicker
            lat={obj[coords.lat] as number | undefined}
            lon={obj[coords.lon] as number | undefined}
            country={(obj.country_code ?? obj.countryCode) as string | undefined}
            onChange={(lat, lon) => onChange(withKey(withKey(value, coords.lat, lat), coords.lon, lon))}
          />
        </div>
      )}
      {entries.map(([key, raw]) => {
        const child = normalize(raw);
        const props: FieldProps = {
          name: key,
          schema: child,
          value: obj[key],
          onChange: v => onChange(withKey(value, key, v)),
          required: required.has(key),
          path: `${path}-${key}`,
        };

        if (child.type === 'object' && child.properties) {
          // Required sections are open; optional ones start collapsed to keep the form short
          return (
            <div key={key} className="col-12">
              <details className="border rounded px-2 py-1" open={props.required}>
                <summary className="small fw-semibold py-1">
                  {humanize(key)}
                  {props.required ? <span className="text-danger ms-1">*</span> : <span className="text-body-secondary fw-normal ms-1">(optional)</span>}
                </summary>
                {child.description && <div className="form-text mt-0 mb-1">{child.description}</div>}
                <div className="pb-2"><ObjectFields schema={child} value={obj[key]} onChange={props.onChange} path={props.path} /></div>
              </details>
            </div>
          );
        }
        if (child.type === 'array') {
          return <div key={key} className="col-12"><ArrayField {...props} /></div>;
        }
        if (child.type === 'object' || (!child.type && !child.enum)) {
          return <div key={key} className="col-12"><JsonField {...props} /></div>;
        }
        return <div key={key} className="col-sm-6 col-xl-4"><PrimitiveField {...props} /></div>;
      })}
    </div>
  );
};

interface SchemaFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  idPrefix: string;
}

export const SchemaForm: React.FC<SchemaFormProps> = ({ schema, value, onChange, idPrefix }) => {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return <p className="small text-body-secondary mb-0">This tool takes no input.</p>;
  }
  return (
    <ObjectFields schema={normalize(schema)} value={value}
      onChange={v => onChange((v ?? {}) as Record<string, unknown>)} path={idPrefix} />
  );
};
