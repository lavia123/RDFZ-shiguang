import type { Item } from "../../shared/types";
import { ItemCard } from "./ItemCards";
interface Props {
  active: boolean;
  items: Item[];
  search: string;
  from: string;
  to: string;
  onSearch: (value: string) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onOpen: (id: string) => void;
}
export function BrowsePanel({
  active,
  items,
  search,
  from,
  to,
  onSearch,
  onFrom,
  onTo,
  onOpen,
}: Props) {
  return (
    <section className={"panel" + (active ? " active" : "")} id="panel-browse">
      <div className="panel-head">
        <h1>看看捡到的东西</h1>
        <p>这里是已经公开的招领。可以搜关键词，也可以按日期找。领取地点会直接写出来。</p>
      </div>
      <div className="toolbar">
        <label className="field grow">
          <span>关键词搜索</span>
          <input
            type="search"
            id="searchInput"
            placeholder="描述、地点或联系方式"
            value={search}
            onChange={(e) => onSearch(e.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>起始日期</span>
          <input
            type="date"
            id="dateFrom"
            value={from}
            onChange={(e) => onFrom(e.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>结束日期</span>
          <input
            type="date"
            id="dateTo"
            value={to}
            onChange={(e) => onTo(e.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          id="clearFilters"
          onClick={() => {
            onSearch("");
            onFrom("");
            onTo("");
          }}
        >
          清空筛选
        </button>
        <span className="count" id="itemCount">{`共 ${items.length} 件`}</span>
      </div>
      <div className="items-grid" id="itemsGrid">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
      <div className="empty" id="emptyState" hidden={items.length > 0}>
        还没有符合条件的物品。
      </div>
    </section>
  );
}
