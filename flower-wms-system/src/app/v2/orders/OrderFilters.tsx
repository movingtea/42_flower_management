import { V2FilterBar, V2FilterField, input } from "../_components/V2Ui";
import {
  COMMERCIAL_FILTER_OPTIONS,
  FULFILLMENT_FILTER_OPTIONS,
  PRODUCTION_FILTER_OPTIONS,
  SUPPLY_FILTER_OPTIONS,
  type OrderFilterValues,
} from "../_lib/order-ui";
import type { OrderView } from "./OrderViewToggle";

type Option = { value: string; label: string };

function FilterSelect({ label, name, value, options }: {
  label: string;
  name: keyof OrderFilterValues;
  value?: string;
  options: readonly Option[];
}) {
  return (
    <V2FilterField label={label} className="w-40">
      <select className={`${input} w-full`} name={name} defaultValue={value ?? ""}>
        <option value="">全部{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </V2FilterField>
  );
}

/**
 * Native GET filter bar: the server component reads the same six keys from
 * searchParams. `view` is preserved so filtering in list mode stays in list mode.
 */
export function OrderFilters({ values, resultCount, view = "board" }: {
  values: OrderFilterValues;
  resultCount: number;
  view?: OrderView;
}) {
  return (
    <V2FilterBar
      action="/v2/orders"
      label="订单筛选"
      keyword={{
        defaultValue: values.q ?? "",
        placeholder: "订单号、顾客、电话",
        label: "订单号 / 顾客关键词",
      }}
      resetHref={view === "list" ? "/v2/orders?view=list" : "/v2/orders"}
      hidden={view === "list" ? <input type="hidden" name="view" value="list" /> : null}
      actions={<span className="px-1 text-xs text-stone-500">当前筛选共 {resultCount} 单</span>}
    >
      <V2FilterField label="交付日期" className="w-40">
        <input
          className={`${input} w-full`}
          name="deliveryDate"
          type="date"
          defaultValue={values.deliveryDate ?? ""}
        />
      </V2FilterField>
      <FilterSelect label="商业状态" name="commercial" value={values.commercial} options={COMMERCIAL_FILTER_OPTIONS} />
      <FilterSelect label="供应状态" name="supply" value={values.supply} options={SUPPLY_FILTER_OPTIONS} />
      <FilterSelect label="制作状态" name="production" value={values.production} options={PRODUCTION_FILTER_OPTIONS} />
      <FilterSelect label="交付状态" name="fulfillment" value={values.fulfillment} options={FULFILLMENT_FILTER_OPTIONS} />
    </V2FilterBar>
  );
}
