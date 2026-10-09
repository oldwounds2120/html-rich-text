/**
 * TableLayout.ets
 * 表格矩阵展开：把「逐行单元格」摊平成稠密的网格槽位序列（含补位空单元）。
 *
 * 为什么需要它（真机表格错位的根因）：
 *  - ArkUI Grid 只在**同时**设置 columnsTemplate 与 rowsTemplate 时，
 *    rowStart/rowEnd/columnStart/columnEnd 才能按绝对行列号布局；
 *  - 只设 columnsTemplate 时，columnStart/columnEnd 仅表示"占几列"，
 *    若该起始位置已被占用则**直接换行**放置，rowStart/rowEnd 则完全无效。
 *  于是 rowspan 失效；行中间的 colspan 会把后面的单元格挤到下一行，
 *  真机表现为整表错位（行尾单元格跑到下一行、列宽忽宽忽窄、出现半张空表）。
 *
 * 解法：本模块自行实现 HTML 表格的分格算法，算出每个单元格的真实起始列，
 * 并为空缺位置补上占位单元，使整张表成为"无空洞的稠密网格"。
 * 渲染层只按顺序流式填充，跨行/跨列单元格通过 irregularSize 交给 Grid 占据多行多列。
 */
import { TableCell } from './RichTextModels.ts';

/** 表格渲染槽位：一个槽位 = 一个 GridItem，顺序即 Grid 的填充顺序（行优先） */
export class TableSlot {
  /** 扁平顺序号（0-based，等于它在该 Grid 中的 GridItem 序号） */
  index: number = 0;
  /** 0-based 行号（表头/表体拆成两个 Grid 时仍是全表行号，用于行高对齐） */
  rowIndex: number = 0;
  /** 0-based 起始列 */
  colStart: number = 0;
  colSpan: number = 1;
  rowSpan: number = 1;
  /** 补位空单元：该行该列在 HTML 里没有单元格（行尾补齐 / 为上方跨行单元格让位） */
  isEmpty: boolean = false;
  /** 非补位单元对应的数据模型 */
  cell?: TableCell;

  constructor() {
    this.cell = undefined;
  }
}

/** 占位矩阵按需扩容（rowspan 会让后续行需要比当前更宽的行） */
function ensureWidth(occupied: boolean[][], row: number, width: number): void {
  while (occupied.length <= row) {
    occupied.push([]);
  }
  const line: boolean[] = occupied[row];
  while (line.length < width) {
    line.push(false);
  }
}

function isOccupied(occupied: boolean[][], row: number, col: number): boolean {
  if (row < 0 || row >= occupied.length) {
    return false;
  }
  const line: boolean[] = occupied[row];
  return col >= 0 && col < line.length && line[col];
}

/**
 * 表格真实列数：按 HTML 分格规则逐行向左填格，返回被占用的最大列数。
 *
 * 注意不能简单取"每行 colspan 之和的最大值"：当 rowspan 与 rowspan 叠加时，
 * 后续行会被上方的跨行格顶到更靠右的列，真实列数会大于任何一行的 colspan 之和
 * （例：<tr><td rowspan=3></tr><tr><td rowspan=2><td></tr><tr><td><td></tr> 实际是 4 列）。
 */
export function countTableCols(rows: TableCell[][]): number {
  const occupied: boolean[][] = [];
  let maxCols: number = 0;
  for (let r = 0; r < rows.length; r++) {
    let col: number = 0;
    for (const cell of rows[r]) {
      while (isOccupied(occupied, r, col)) {
        col++;
      }
      const colSpan: number = Math.max(1, cell.colSpan);
      const rowSpan: number = Math.max(1, Math.min(cell.rowSpan, rows.length - r));
      for (let c = col; c < col + colSpan; c++) {
        for (let rr = r; rr < r + rowSpan; rr++) {
          ensureWidth(occupied, rr, c + 1);
          occupied[rr][c] = true;
        }
      }
      col += colSpan;
    }
    if (col > maxCols) {
      maxCols = col;
    }
  }
  return maxCols;
}

/**
 * 展开表格矩阵。
 * @param rows 逐行单元格（文档顺序）；允许某行单元格数少于总列数（HTML 合法写法）
 * @returns 行优先排列的槽位序列：每行都被补满到总列数；为上方 rowspan 让出的空位不再产出槽位
 */
export function buildTableSlots(rows: TableCell[][]): TableSlot[] {
  const slots: TableSlot[] = [];
  const cols: number = countTableCols(rows);
  if (cols <= 0) {
    return slots;
  }
  // 占位矩阵：true = 该格已被上方跨行单元格或本行已放置的单元格占用
  const occupied: boolean[][] = [];
  for (let r = 0; r < rows.length; r++) {
    ensureWidth(occupied, r, cols);
  }

  let index: number = 0;
  for (let r = 0; r < rows.length; r++) {
    let col: number = 0;
    const row: TableCell[] = rows[r];
    for (const cell of row) {
      // 跳过被上方跨行单元格占用的列
      while (col < cols && isOccupied(occupied, r, col)) {
        col++;
      }
      if (col >= cols) {
        // 兜底保护：真实列数由 countTableCols 保证，这里只防畸形数据把整表撑乱
        break;
      }
      const colSpan: number = Math.max(1, Math.min(cell.colSpan, cols - col));
      const rowSpan: number = Math.max(1, Math.min(cell.rowSpan, rows.length - r));
      for (let c = col; c < col + colSpan; c++) {
        for (let rr = r; rr < r + rowSpan; rr++) {
          occupied[rr][c] = true;
        }
      }
      const slot: TableSlot = new TableSlot();
      slot.index = index++;
      slot.rowIndex = r;
      slot.colStart = col;
      slot.colSpan = colSpan;
      slot.rowSpan = rowSpan;
      slot.cell = cell;
      slots.push(slot);
      col += colSpan;
    }
    // 行尾补位：让每一行都铺满 cols 列（被跨行单元格占用的列不用补）
    while (col < cols) {
      if (isOccupied(occupied, r, col)) {
        col++;
        continue;
      }
      const start: number = col;
      while (col < cols && !isOccupied(occupied, r, col)) {
        col++;
      }
      const slot: TableSlot = new TableSlot();
      slot.index = index++;
      slot.rowIndex = r;
      slot.colStart = start;
      slot.colSpan = col - start;
      slot.rowSpan = 1;
      slot.isEmpty = true;
      slots.push(slot);
    }
  }
  return slots;
}

/**
 * 表头行数：从第 0 行起、连续满足"每个单元格都是 th"的行。
 * 表体独立滚动时，这几行会被单独渲染在滚动区之外以保持可见。
 */
export function countHeaderRows(rows: TableCell[][]): number {
  let n: number = 0;
  for (const row of rows) {
    if (row.length === 0) {
      break;
    }
    let allHeader: boolean = true;
    for (const cell of row) {
      if (!cell.isHeader) {
        allHeader = false;
        break;
      }
    }
    if (!allHeader) {
      break;
    }
    n++;
  }
  return n;
}
