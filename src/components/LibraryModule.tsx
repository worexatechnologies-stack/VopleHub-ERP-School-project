import React, { useState } from 'react';
import { Search, BookOpen, Plus, ClipboardCheck, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { INITIAL_BOOKS } from '../data/mockData';
import { Book } from '../types';
import { emitNotification } from '../services/notificationBus';

export default function LibraryModule() {
  const [books, setBooks] = useState<Book[]>(INITIAL_BOOKS);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const [issuedLogs, setIssuedLogs] = useState<{ id: string; title: string; student: string; dueDate: string }[]>([]);

  const categories = ['All', ...Array.from(new Set(books.map((book) => book.category).filter(Boolean)))];

  const filteredBooks = books.filter(book => {
    const matchesSearch = book.title.toLowerCase().includes(search.toLowerCase()) || book.author.toLowerCase().includes(search.toLowerCase()) || book.isbn.includes(search);
    const matchesCat = categoryFilter === 'All' || book.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const handleBorrow = (bookId: string) => {
    const updated = books.map(book => {
      if (book.id === bookId && book.availableCopies > 0) {
        // Log borrow
        const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString();
        const newLog = {
          id: `log-${Date.now()}`,
          title: book.title,
          student: 'Unassigned borrower',
          dueDate,
        };
        setIssuedLogs(prev => [newLog, ...prev]);

        emitNotification({
          title: 'Book Borrowed',
          message: `Borrowed "${book.title}". Due date: ${dueDate}.`,
          tone: 'success',
          source: 'library',
        });

        return { ...book, availableCopies: book.availableCopies - 1 };
      }
      return book;
    });
    setBooks(updated);
  };

  const handleReturn = (logId: string, bookTitle: string) => {
    // Filter log
    setIssuedLogs(issuedLogs.filter(log => log.id !== logId));

    // Refill copy
    const targetBook = books.find(b => b.title === bookTitle);
    if (targetBook) {
      setBooks(books.map(b => b.id === targetBook.id ? { ...b, availableCopies: b.availableCopies + 1 } : b));
    }

    emitNotification({
      title: 'Book Returned',
      message: `Returned "${bookTitle}" back to library inventory.`,
      tone: 'info',
      source: 'library',
    });
  };

  return (
    <div className="space-y-6" id="library-module">
      <div>
        <h2 className="text-base font-sans font-semibold text-slate-900">Library Inventory & Issue Desk</h2>
        <p className="text-xs text-slate-500">Search and manage physical books catalog, borrow/return allocations, and monitor overdue fines.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Book inventory */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col h-[520px] overflow-hidden">
          {/* Controls */}
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search ISBN, book title or author..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs w-full p-2 rounded-lg border border-slate-200 focus:outline-indigo-500 bg-white"
              />
            </div>
            <div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="text-xs p-2 rounded-lg border border-slate-200 bg-white focus:outline-indigo-500"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Catalog grid */}
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredBooks.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs col-span-2">No matching items in catalog.</div>
            ) : (
              filteredBooks.map((book) => (
                <div key={book.id} className="p-4 bg-slate-50/50 border border-slate-200 rounded-lg flex flex-col justify-between">
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-wider">{book.category}</span>
                    <h3 className="text-xs font-bold text-slate-900 leading-snug mt-1">{book.title}</h3>
                    <p className="text-[10px] text-slate-500">Author: {book.author}</p>
                    <p className="text-[9px] font-mono text-slate-400">Shelf: {book.shelfLocation} · ISBN: {book.isbn}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-[10px]">
                    <span className="font-semibold text-slate-600">Available: {book.availableCopies} / {book.totalCopies}</span>
                    <button
                      onClick={() => handleBorrow(book.id)}
                      disabled={book.availableCopies === 0}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[10px] py-1 px-3 rounded-md disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
                    >
                      Borrow
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Issuances & Borrow logs */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between h-[520px]">
          <div className="space-y-4 overflow-hidden flex flex-col h-full">
            <h3 className="font-sans font-semibold text-slate-800 border-b border-slate-50 pb-3">Active Issues Log</h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {issuedLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-400">
                  <ClipboardCheck className="w-8 h-8 text-slate-300 mb-2" />
                  <span>No outstanding issued books logged.</span>
                </div>
              ) : (
                issuedLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-[11px] space-y-1.5 flex justify-between items-start gap-3">
                    <div>
                      <h4 className="font-bold text-slate-800 leading-snug">{log.title}</h4>
                      <p className="text-[10px] text-slate-500">Issued to: {log.student}</p>
                      <p className="text-[10px] text-rose-600 font-mono">Due date: {log.dueDate}</p>
                    </div>
                    <button
                      onClick={() => handleReturn(log.id, log.title)}
                      className="text-[10px] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-2 py-1 rounded"
                    >
                      Return
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-slate-50 pt-4 mt-4">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Fine schedule guidelines</h4>
            <div className="bg-amber-50 border border-amber-100/50 p-3 rounded-lg flex gap-2.5 items-start text-[11px] text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <p>Books overdue by more than 14 days will accumulate a fine of **₹10.00 / day** charged to school ledger.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
