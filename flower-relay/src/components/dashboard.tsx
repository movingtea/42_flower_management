"use client";

import {
  ArrowRight, Box, Check, ChevronDown, ChevronRight, CircleDollarSign, Flower2,
  Layers3, Leaf, ListRestart, PackageCheck, PencilLine, Plus, Recycle,
  Settings2, Sparkles, Sprout, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { optimize } from "@/lib/optimizer";
import type { MaterialInput, Plan, SampleInput } from "@/lib/types";
import { EditorModal, type EditorTarget } from "@/components/editor-modal";

type View = "plan" | "samples" | "materials";
const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });

export function Dashboard({ samples, materials }: { samples: SampleInput[]; materials: MaterialInput[] }) {
  const [view, setView] = useState<View>("plan");
  const [selectedIds, setSelectedIds] = useState(() => samples.map((sample) => sample.id));
  const [sampleCount, setSampleCount] = useState(Math.min(4, samples.length));
  const [plans, setPlans] = useState<Plan[]>(() => optimize(samples, Math.min(4, samples.length)));
  const [activePlan, setActivePlan] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const selectedSamples = useMemo(() => samples.filter((sample) => selectedIds.includes(sample.id)), [samples, selectedIds]);
  const plan = plans[activePlan] ?? plans[0];

  function runOptimization() {
    setPlans(optimize(selectedSamples, Math.min(sampleCount, selectedSamples.length)));
    setActivePlan(0); setExpandedStep(0); setShowSettings(false);
  }
  function toggleSample(id: number) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("plan")} aria-label="返回复用方案"><span className="brand-mark"><Sprout size={19} /></span><span><strong>花材接力</strong><small>Flower Relay</small></span></button>
      <nav aria-label="主导航"><button className={view === "samples" ? "active" : ""} onClick={() => setView("samples")}>样品库</button><button className={view === "materials" ? "active" : ""} onClick={() => setView("materials")}>花材库</button><button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}>复用方案</button></nav>
      <div className="profile"><span>花艺工作室</span><button aria-label="账户菜单">林</button></div>
    </header>

    {view === "plan" && plan ? <main className="page-shell">
      <section className="page-heading"><div><div className="eyebrow"><span>方案</span><i />2026 秋季推广</div><h1>样品制作计划</h1><p>按照拆解后的可用花材，安排最省采购成本的制作顺序。</p></div><div className="heading-actions"><button className="button secondary" onClick={() => setShowSettings(true)}><Settings2 size={16} />调整条件</button><button className="button primary"><Check size={17} />确认并开始</button></div></section>
      <section className="metric-grid" aria-label="方案摘要">
        <Metric icon={<CircleDollarSign />} label="预计节省" value={money.format(plan.savings)} note={`较独立制作节省 ${Math.round((plan.savings / plan.independentCost) * 100)}%`} tone="sage" />
        <Metric icon={<Recycle />} label="花材复用率" value={`${plan.reuseRate}%`} note={`共复用 ${plan.totalReused} 枝花材`} tone="rose" />
        <Metric icon={<Flower2 />} label="样品数量" value={`${plan.steps.length} 款`} note={`总采购成本 ${money.format(plan.totalCost)}`} tone="gold" />
      </section>
      <div className="content-grid"><section className="panel sequence-panel">
        <div className="panel-heading"><div><h2>推荐制作顺序</h2><p>拆解确认后，可按实际可用花材重新计算</p></div><div className="plan-switcher"><span>方案</span>{plans.slice(0, 3).map((_, index) => <button key={index} className={activePlan === index ? "active" : ""} onClick={() => setActivePlan(index)}>{String.fromCharCode(65 + index)}</button>)}</div></div>
        <div className="sequence-list">{plan.steps.map((step, index) => { const expanded = expandedStep === index; return <div className="sequence-wrap" key={step.sample.id}>
          <article className={`sequence-card ${index === 0 ? "current" : ""}`}><span className="step-number">{index + 1}</span><div className="sample-art" style={{ "--sample-color": step.sample.color } as React.CSSProperties}><Flower2 size={25} /></div><div className="sample-copy"><h3>{step.sample.name}</h3><p>{step.sample.subtitle}</p><span>用花合计 {step.materials.reduce((sum, item) => sum + item.required, 0)} 枝</span></div><div className="step-stat"><Recycle size={15} /><span>复用花材</span><strong>{step.reusedCount} 枝</strong></div><div className="step-stat"><PackageCheck size={15} /><span>补充采购</span><strong>{step.purchasedCount} 枝</strong></div><div className="step-stat cost"><CircleDollarSign size={15} /><span>增量成本</span><strong>{money.format(step.incrementalCost)}</strong></div><button className="detail-button" aria-label={`查看${step.sample.name}明细`} aria-expanded={expanded} onClick={() => setExpandedStep(expanded ? null : index)}><ChevronDown size={18} /></button></article>
          {expanded && <div className="material-detail">{step.materials.map((material) => <div key={material.materialId}><strong>{material.name}</strong><span>需求 {material.required}</span><span className="positive">复用 {material.reused}</span><span>补充 {material.purchased}</span><span>拆解后 {material.availableAfter}</span></div>)}</div>}
          {index < plan.steps.length - 1 && <div className="handoff"><span><Recycle size={13} />拆解后进入可用花材池</span></div>}
        </div>; })}</div>
      </section><aside className="side-column"><section className="panel flow-panel"><div className="panel-heading"><div><h2>花材流转</h2><p>计划结束后的预计使用情况</p></div><Leaf size={19} /></div><div className="flow-list">{plan.flows.slice(0, 5).map((flow) => { const ratio = Math.min(100, Math.round((flow.reused / Math.max(flow.purchased, 1)) * 100)); return <div className="flow-item" key={flow.id}><div className="flow-name"><i style={{ background: flow.color }} /><strong>{flow.name}</strong><span>复用 {flow.useCount - 1} 次</span></div><div className="flow-numbers"><span>采购 {flow.purchased} {flow.unit}</span><b>预计剩余 {flow.remaining} {flow.unit}</b></div><div className="progress"><i style={{ width: `${ratio}%` }} /></div></div>; })}</div></section><section className="insight-card"><span><Sparkles size={18} /></span><div><strong>为什么推荐这个顺序？</strong><p>先制作花材需求量最大的样品，拆解后覆盖后续小型样品，可减少多次补购。</p></div></section><button className="purchase-card"><span><Box size={18} /></span><div><strong>查看初始采购清单</strong><small>{plan.flows.length} 种花材 · {money.format(plan.steps[0]?.incrementalCost ?? 0)}</small></div><ChevronRight size={18} /></button></aside></div>
    </main> : view === "samples" ? <LibraryView title="样品库" subtitle="选择参与本次复用规划的候选样品" icon={<Layers3 />} action="新建样品" onAction={() => setEditor({ type: "sample" })}><div className="sample-grid">{samples.map((sample) => { const checked = selectedIds.includes(sample.id); return <article className={`sample-tile ${checked ? "selected" : ""}`} key={sample.id}><button className="tile-select" onClick={() => toggleSample(sample.id)} aria-label={`${checked ? "取消选择" : "选择"}${sample.name}`}><div className="tile-art" style={{ "--sample-color": sample.color } as React.CSSProperties}><Flower2 size={30} /><span>{checked && <Check size={14} />}</span></div><div><h3>{sample.name}</h3><p>{sample.subtitle}</p></div></button><footer><span>{sample.materials.length} 种花材 · {sample.materials.reduce((sum, item) => sum + item.quantity, 0)} 枝</span><button onClick={() => setEditor({ type: "sample", item: sample })}><PencilLine size={14} />编辑</button></footer></article>; })}</div><div className="library-footer"><span>已选择 {selectedIds.length} 个候选样品</span><button className="button primary" onClick={() => { runOptimization(); setView("plan"); }}>生成复用方案<ArrowRight size={16} /></button></div></LibraryView> : <LibraryView title="花材库" subtitle="花材价格与拆解损耗将参与方案计算" icon={<Leaf />} action="新增花材" onAction={() => setEditor({ type: "material" })}><div className="material-table-wrap"><table className="material-table"><thead><tr><th>花材</th><th>分类</th><th>采购单价</th><th>拆解损耗</th><th>使用样品</th><th /></tr></thead><tbody>{materials.map((material) => <tr key={material.id}><td><i style={{ background: material.color }} /><strong>{material.name}</strong></td><td><span className="category-pill">{material.category}</span></td><td>{money.format(material.unitPrice)} / {material.unit}</td><td>{Math.round(material.lossRate * 100)}%</td><td>{samples.filter((sample) => sample.materials.some((item) => item.material.id === material.id)).length} 款</td><td><button aria-label={`编辑${material.name}`} onClick={() => setEditor({ type: "material", item: material })}><PencilLine size={15} /></button></td></tr>)}</tbody></table></div></LibraryView>}

    {showSettings && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSettings(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><span><ListRestart size={18} /></span><div><h2 id="settings-title">调整计算条件</h2><p>选择候选范围与本次需要制作的样品数量</p></div></div><button onClick={() => setShowSettings(false)} aria-label="关闭"><X size={19} /></button></div><label className="field-label" htmlFor="sample-count">需要制作的样品数量</label><select id="sample-count" value={sampleCount} onChange={(event) => setSampleCount(Number(event.target.value))}>{[2, 3, 4, 5].filter((count) => count <= selectedSamples.length).map((count) => <option key={count} value={count}>{count} 款</option>)}</select><div className="field-label row-label"><span>候选样品</span><small>已选择 {selectedIds.length} 款</small></div><div className="modal-samples">{samples.map((sample) => { const checked = selectedIds.includes(sample.id); return <label key={sample.id}><input type="checkbox" checked={checked} onChange={() => toggleSample(sample.id)} /><span><i style={{ background: sample.color }} /><b>{sample.name}</b><small>{sample.materials.length} 种花材</small></span></label>; })}</div><div className="modal-actions"><button className="button secondary" onClick={() => setShowSettings(false)}>取消</button><button className="button primary" disabled={selectedSamples.length < 2} onClick={runOptimization}>重新计算<Sparkles size={16} /></button></div></section></div>}
    {editor && <EditorModal target={editor} materials={materials} onClose={() => setEditor(null)} />}
  </div>;
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string }) { return <article className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div><i className="botanical-mark"><Leaf /><Leaf /></i></article>; }
function LibraryView({ title, subtitle, icon, action, onAction, children }: { title: string; subtitle: string; icon: React.ReactNode; action: string; onAction: () => void; children: React.ReactNode }) { return <main className="page-shell library-page"><section className="page-heading"><div><div className="eyebrow"><span>基础数据</span></div><h1>{title}</h1><p>{subtitle}</p></div><button className="button primary" onClick={onAction}><Plus size={17} />{action}</button></section><div className="library-title-icon">{icon}</div>{children}</main>; }
