import Link from "next/link";
import { input } from "../_components/V2Ui";
import {
  COMMERCIAL_FILTER_OPTIONS,
  FULFILLMENT_FILTER_OPTIONS,
  PRODUCTION_FILTER_OPTIONS,
  SUPPLY_FILTER_OPTIONS,
  type OrderFilterValues,
} from "../_lib/order-ui";

type Option = { value: string; label: string };

const selectClass = `${input} mt-1`;

function FilterSelect({ label, name, value, options }: {
  label: string;
  name: keyof OrderFilterValues;
  value?: string;
  options: readonly Option[];
}) {
  return (
    <label className="block text-sm text-stone-700">
      {label}
      <select className={selectClass} name={name} defaultValue={value ?? ""}>
        <option value="">全部{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Native GET form: the server component reads the same six keys from searchParams. */
export function OrderFilters({ values, resultCount }: {
  values: OrderFilterValues;
  resultCount: number;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <form key={JSON.stringify(values)} method="get" action="/v2/orders" className="grid gap-3 md:grid-cols-2 xl:grid-cols-7 xl:items-end">
        <label className="block text-sm text-stone-700 xl:col-span-2">
          订单号 / 顾客关键词
          <input
            className={`${input} mt-1`}
            name="q"
            defaultValue={values.q ?? ""}
            placeholder="订单号、顾客、电话"
          />
        </label>
        <label className="block text-sm text-stone-700">
          交付日期
          <input
            className={`${input} mt-1`}
            name="deliveryDate"
            type="date"
            defaultValue={values.deliveryDate ?? ""}
          />
        </label>
        <FilterSelect label="商业状态" name="commercial" value={values.commercial} options={COMMERCIAL_FILTER_OPTIONS} />
        <FilterSelect label="供应状态" name="supply" value={values.supply} options={SUPPLY_FILTER_OPTIONS} />
        <FilterSelect label="制作状态" name="production" value={values.production} options={PRODUCTION_FILTER_OPTIONS} />
        <FilterSelect label="交付状态" name="fulfillment" value={values.fulfillment} options={FULFILLMENT_FILTER_OPTIONS} />
        <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-7">
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
            筛选
          </button>
          <Link
            href="/v2/orders"
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            重置
          </Link>
          <span className="text-xs text-stone-500">当前结果 {resultCount} 单（最多显示 200 单）</span>
        </div>
      </form>
    </section>
  );
}
