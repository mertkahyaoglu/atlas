"use client";

import { createContext, useContext } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Table2 } from "lucide-react";
import { CONSTRAINT, columnType, type LaidOutTable } from "@/lib/diagram/erd";
import { cn } from "@/lib/utils";

export type TableState = "idle" | "active" | "dimmed";
export type TableNodeData = {
  table: LaidOutTable;
  /** Active when focused; dimmed when another table is and no key links the two. */
  state: TableState;
  /** Columns at either end of a highlighted key. */
  linked: ReadonlySet<string>;
};
export type TableNode = Node<TableNodeData, "table">;

/** Table nodes are rendered by React Flow, so a hovered column reaches the canvas through context. */
export const ErdContext = createContext<(table: string, column?: string) => void>(() => {});

/**
 * Connectors are drawn from layout points, but React Flow still needs a handle
 * at each end, declared up front so edges show before nodes are measured.
 */
export function tableHandles(table: LaidOutTable): NonNullable<Node["handles"]> {
  return [
    { type: "target", position: Position.Left, x: 0, y: table.height / 2, width: 1, height: 1 },
    { type: "source", position: Position.Right, x: table.width, y: table.height / 2, width: 1, height: 1 },
  ];
}

export function TableNodeView({ data }: NodeProps<TableNode>) {
  const { table, state, linked } = data;
  const focusColumn = useContext(ErdContext);
  // With a sort key, PK is the partition key (Cassandra, DynamoDB).
  const partitioned = table.columns.some((column) => column.sk);

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="flow-handle" />
      <div role="group" aria-label={`Table ${table.name}`} className={cn("erd-table", `is-${state}`)}>
        <div className="erd-table__header">
          <Table2 aria-hidden strokeWidth={1.75} />
          {table.name}
          {table.kind && <span className="erd-table__kind">{table.kind}</span>}
        </div>

        {table.columns.map((column) => (
          <div
            key={column.name}
            className={cn("erd-row", linked.has(column.name) && "is-linked")}
            onMouseEnter={() => focusColumn(table.name, column.name)}
            onMouseLeave={() => focusColumn(table.name)}
          >
            <span className="erd-row__name">{column.name}</span>
            {column.pk && (
              <span className="erd-badge erd-badge--pk" title={partitioned ? "Partition key" : "Primary key"}>
                PK
              </span>
            )}
            {column.sk && (
              <span className="erd-badge erd-badge--sk" title={column.desc ? "Sort key, newest first" : "Sort key"}>
                {column.desc ? "SK↓" : "SK"}
              </span>
            )}
            {column.ref && (
              <span
                className="erd-badge erd-badge--fk"
                title={`Foreign key to ${column.ref.table}${column.ref.column ? `.${column.ref.column}` : ""}`}
              >
                FK
              </span>
            )}
            <span className="erd-row__type">{columnType(column)}</span>
          </div>
        ))}

        {table.constraintLines.length > 0 && (
          <div className="erd-table__section">
            {table.constraintLines.map((line, i) => {
              const keyword = CONSTRAINT.exec(line)?.[0];
              return (
                <div key={i}>
                  {keyword && <span className="erd-table__keyword">{keyword}</span>}
                  {keyword ? line.slice(keyword.length) : line}
                </div>
              );
            })}
          </div>
        )}

        {table.noteLines.length > 0 && (
          <div className="erd-table__section">
            <div className="erd-table__note">
              {table.noteLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="flow-handle" />
    </>
  );
}
