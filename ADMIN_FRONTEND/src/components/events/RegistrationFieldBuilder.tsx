import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { RegistrationField, RegistrationFieldType } from "../../api/events";
import Button from "../ui/Button";

const fieldTypes: RegistrationFieldType[] = ["TEXT", "TEXTAREA", "NUMBER", "DROPDOWN", "RADIO", "CHECKBOX", "DATE", "URL"];
const optionTypes: RegistrationFieldType[] = ["DROPDOWN", "RADIO", "CHECKBOX"];

interface Props {
  fields: RegistrationField[];
  onChange: (fields: RegistrationField[]) => void;
  readOnly?: boolean;
}

export default function RegistrationFieldBuilder({ fields, onChange, readOnly = false }: Props) {
  const update = (index: number, patch: Partial<RegistrationField>) => onChange(fields.map((field, i) => i === index ? { ...field, ...patch } : field));
  const add = () => onChange([...fields, { label: "", fieldKey: "", fieldType: "TEXT", required: false, options: [], order: fields.length }]);
  const remove = (index: number) => onChange(fields.filter((_, i) => i !== index).map((field, order) => ({ ...field, order })));
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= fields.length) return;
    const reordered = [...fields];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(reordered.map((field, order) => ({ ...field, order })));
  };

  return <div className="field-builder">
    {fields.length === 0 && <div className="field-builder-empty">No custom registration fields added.</div>}
    {fields.map((field, index) => {
      return <article className="registration-field-card" key={`${field.fieldId ?? "new"}-${index}`}>
        <div className="field-card-heading"><span className="field-order">{String(index + 1).padStart(2, "0")}</span><strong>{field.label || "New field"}</strong>
          {!readOnly && <div className="field-order-actions"><button type="button" className="tiny-icon-button" aria-label="Move field up" onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp size={14} /></button><button type="button" className="tiny-icon-button" aria-label="Move field down" onClick={() => move(index, 1)} disabled={index === fields.length - 1}><ArrowDown size={14} /></button><button type="button" className="tiny-icon-button danger-icon" aria-label={`Remove ${field.label || "field"}`} onClick={() => remove(index)}><Trash2 size={14} /></button></div>}
        </div>
        <div className="field-config-grid">
          <label className="form-field"><span>Label <b>*</b></span><input value={field.label} onChange={event => update(index, { label: event.target.value })} required={!readOnly} disabled={readOnly} placeholder="e.g. T-shirt size" /></label>
          <label className="form-field"><span>Field key <b>*</b></span><input value={field.fieldKey} onChange={event => update(index, { fieldKey: event.target.value })} required={!readOnly} disabled={readOnly} pattern="[a-zA-Z][a-zA-Z0-9_]*" placeholder="e.g. tshirtSize" /><small>Start with a letter; use letters, numbers, underscores.</small></label>
          <label className="form-field"><span>Field type</span><select value={field.fieldType} onChange={event => update(index, { fieldType: event.target.value as RegistrationFieldType, options: optionTypes.includes(event.target.value as RegistrationFieldType) ? field.options : [] })} disabled={readOnly}>{fieldTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
          {optionTypes.includes(field.fieldType) && <label className="form-field field-options"><span>Options <b>*</b></span><textarea value={field.options.join("\n")} onChange={event => update(index, { options: event.target.value.split("\n").map(option => option.trim()).filter(Boolean) })} required={!readOnly} disabled={readOnly} placeholder={"One option per line\nSmall\nMedium\nLarge"} rows={3} /></label>}
        </div>
        <label className="required-toggle"><input type="checkbox" checked={field.required} onChange={event => update(index, { required: event.target.checked })} disabled={readOnly} /><span>Required response</span></label>
      </article>;
    })}
    {!readOnly && <Button type="button" variant="secondary" icon={<Plus size={15} />} onClick={add}>Add registration field</Button>}
  </div>;
}
