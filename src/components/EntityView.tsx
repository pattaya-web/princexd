"use client";

import { useMemo, useState } from "react";
import { useCollection } from "@/lib/client";
import { blankRecord, type EntitySpec, type FieldSpec } from "@/lib/schemas";
import { fmtDate, fmtDateTime, fmtEur, fmtInt, label } from "@/lib/format";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, Tabs, Toggle, useToast } from "./ui";

type Row = { id: string } & Record<string, unknown>;

/* ----------------------------- Rendu cellule ---------------------------- */

function display(field: FieldSpec, value: unknown) {
  if (value === "" || value === null || value === undefined) return <span className="dim">—</span>;
  switch (field.kind) {
    case "money":
      return <span className="num">{fmtEur(Number(value))}</span>;
    case "number":
      return <span className="num">{fmtInt(Number(value))}</span>;
    case "pct":
      return <span className="num">{Number(value)} %</span>;
    case "date":
      return <span className="num">{fmtDate(String(value))}</span>;
    case "datetime":
      return <span className="num">{fmtDateTime(String(value))}</span>;
    case "bool":
      return value ? <span className="badge badge-good">Oui</span> : <span className="dim">Non</span>;
    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="link">
          Ouvrir ↗
        </a>
      );
    case "select":
      return <span className="badge">{label(String(value))}</span>;
    default: {
      const text = String(value);
      return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}…` : text}</span>;
    }
  }
}

/* ----------------------------- Champ de saisie -------------------------- */

function Input({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case "textarea":
      return (
        <textarea
          className="textarea"
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <select className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {label(o)}
            </option>
          ))}
        </select>
      );
    case "bool":
      return <Toggle checked={Boolean(value)} onChange={onChange} />;
    case "number":
    case "money":
    case "pct":
      return (
        <input
          className="input num"
          type="number"
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "date":
      return <input className="input" type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return (
        <input
          className="input"
          type="datetime-local"
          // <input type=datetime-local> ne comprend pas le suffixe Z de l'ISO.
          value={String(value ?? "").slice(0, 16)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")}
        />
      );
    default:
      return (
        <input
          className="input"
          type={field.kind === "url" ? "url" : "text"}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/* -------------------------------- Vue ---------------------------------- */

export function EntityView({
  spec,
  title,
  summary,
}: {
  spec: EntitySpec;
  title: string;
  /** Bandeau de synthèse calculé par la page appelante. */
  summary?: (rows: Row[]) => React.ReactNode;
}) {
  const { rows, loading, error, create, patch, destroy } = useCollection<Row>(spec.collection);
  const toast = useToast();

  const [view, setView] = useState<"table" | "board">(spec.boardKey ? "board" : "table");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const tableFields = spec.fields.filter((f) => !f.formOnly);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter((r) =>
          spec.fields.some((f) => String(r[f.key] ?? "").toLowerCase().includes(q)),
        )
      : rows;
    if (!spec.sort) return base;
    const { key, dir } = spec.sort;
    return [...base].sort((a, b) => {
      const av = String(a[key] ?? "");
      const bv = String(b[key] ?? "");
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [rows, query, spec]);

  const boardField = spec.fields.find((f) => f.key === spec.boardKey);
  const columns = boardField?.options ?? [];

  const openNew = () => {
    setDraft(blankRecord(spec));
    setEditing({ id: "" } as Row);
  };

  const openEdit = (row: Row) => {
    setDraft({ ...row });
    setEditing(row);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing?.id) await patch(editing.id, draft as Partial<Row>);
      else await create(draft as Partial<Row>);
      setEditing(null);
      toast(editing?.id ? "Enregistré." : `${spec.singular} ajouté.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const del = async (row: Row) => {
    const name = String(row[spec.titleKey] ?? "cet élément");
    if (!window.confirm(`Supprimer « ${name} » ? Cette action est définitive.`)) return;
    try {
      await destroy(row.id);
      setEditing(null);
      toast("Supprimé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            <input
              className="input !w-[190px]"
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {spec.boardKey && (
              <Tabs
                value={view}
                onChange={setView}
                options={[
                  { value: "board", label: "Board" },
                  { value: "table", label: "Tableau" },
                ]}
              />
            )}
            <button className="btn btn-primary" onClick={openNew}>
              + {spec.singular}
            </button>
          </>
        }
      />

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {summary && rows.length > 0 && <div className="mb-4">{summary(rows)}</div>}

      {loading ? (
        <Card><Spinner label="Chargement…" /></Card>
      ) : !rows.length ? (
        <Card>
          <Empty action={<button className="btn btn-primary" onClick={openNew}>+ Ajouter {spec.singular.toLowerCase()}</button>}>
            Rien ici pour l&apos;instant. Ajoute ton premier élément et il apparaîtra dans le board comme dans le tableau.
          </Empty>
        </Card>
      ) : view === "board" && spec.boardKey ? (
        <div className="scroll-x pb-2">
          <div className="flex gap-3 min-w-min">
            {columns.map((col) => {
              const items = filtered.filter((r) => String(r[spec.boardKey!] ?? "") === col);
              return (
                <div key={col} className="w-[264px] shrink-0">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[12.5px] font-semibold">{label(col)}</span>
                    <span className="badge !text-[10.5px]">{items.length}</span>
                  </div>
                  <div
                    className="flex flex-col gap-2 p-2 rounded-[10px] min-h-[90px]"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) void patch(id, { [spec.boardKey!]: col } as Partial<Row>);
                    }}
                  >
                    {items.map((row) => (
                      <article
                        key={row.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", row.id)}
                        onClick={() => openEdit(row)}
                        className="card-flat px-2.5 py-2 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                      >
                        <div className="text-[12.5px] font-medium leading-snug">
                          {String(row[spec.titleKey] ?? "Sans titre")}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                          {tableFields
                            .filter((f) => f.key !== spec.titleKey && f.key !== spec.boardKey)
                            .slice(0, 3)
                            .map((f) =>
                              row[f.key] !== "" && row[f.key] !== 0 && row[f.key] !== undefined ? (
                                <span key={f.key} className="dim text-[11px]">
                                  {f.label} : {display(f, row[f.key])}
                                </span>
                              ) : null,
                            )}
                        </div>
                      </article>
                    ))}
                    {!items.length && <p className="dim text-[11.5px] text-center py-3">Vide</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Card padded={false}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  {tableFields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th style={{ width: 70 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="cursor-pointer" onClick={() => openEdit(row)}>
                    {tableFields.map((f) => (
                      <td key={f.key}>{display(f, row[f.key])}</td>
                    ))}
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-danger" onClick={() => void del(row)} title="Supprimer">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <Empty>Aucun résultat pour « {query} ».</Empty>}
        </Card>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Modifier — ${spec.singular}` : `Nouveau — ${spec.singular}`}
        wide
        footer={
          <>
            {editing?.id && (
              <button className="btn btn-danger mr-auto" onClick={() => editing && void del(editing)}>
                Supprimer
              </button>
            )}
            <button className="btn" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3.5">
          {spec.fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              className={f.kind === "textarea" ? "sm:col-span-2" : ""}
            >
              <Input field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
            </Field>
          ))}
        </div>
      </Modal>
    </>
  );
}
