"use client";

import React from "react";

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
  itemLabelPlural?: string;
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [8, 12, 16, 24, 48],
  itemLabel = "item",
  itemLabelPlural = "items",
}: PaginationProps) {
  if (totalItems <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);

  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, totalItems);

  // Generate page numbers to display with smart ellipsis
  const getPageNumbers = (): (number | "ellipsis")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | "ellipsis")[] = [1];

    if (page > 3) {
      pages.push("ellipsis");
    }

    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (page < totalPages - 2) {
      pages.push("ellipsis");
    }

    pages.push(totalPages);
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className="pagination-wrap" role="navigation" aria-label="Pagination">
      {/* Summary Left */}
      <div className="pagination-summary">
        Showing <strong>{startIdx}</strong>–<strong>{endIdx}</strong> of{" "}
        <strong>{totalItems}</strong>{" "}
        {totalItems === 1 ? itemLabel : itemLabelPlural}
      </div>

      {/* Controls Right */}
      <div className="pagination-controls">
        {onPageSizeChange && (
          <div className="pagination-size">
            <span className="dim">Per page:</span>
            <select
              className="select-sm"
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value);
                onPageSizeChange(newSize);
                onPageChange(1); // Reset to first page
              }}
              aria-label="Items per page"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="pagination-nav">
          {/* Previous Page Button */}
          <button
            type="button"
            className="page-btn"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
            title="Previous page"
          >
            ‹
          </button>

          {/* Page numbers */}
          {pages.map((p, idx) => {
            if (p === "ellipsis") {
              return (
                <span key={`ellipsis-${idx}`} className="page-ellipsis">
                  …
                </span>
              );
            }
            return (
              <button
                key={p}
                type="button"
                className={`page-btn ${p === page ? "active" : ""}`}
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </button>
            );
          })}

          {/* Next Page Button */}
          <button
            type="button"
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
            title="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
