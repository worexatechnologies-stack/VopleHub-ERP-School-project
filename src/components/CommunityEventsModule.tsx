import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  Edit2,
  FileSpreadsheet,
  Globe2,
  MapPin,
  Plus,
  QrCode,
  Search,
  Ticket,
  Trash2,
  Users,
  X
} from 'lucide-react';
import type { AuthUser } from '../utils/auth';
import { emitNotification } from '../services/notificationBus';
import {
  useGetEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useRegisterForEventMutation,
  useCancelEventRegistrationMutation,
  useGetMyRegistrationsQuery,
  useLazyGetEventRegistrationsQuery,
  type SchoolEventRecord,
  type EventRegistrationRecord,
  type EventKind
} from '../store/api/communityApi';

type ActivityFilter = 'all' | 'active' | 'inactive';

export default function CommunityEventsModule({ user }: { user?: AuthUser | null }) {
  const role = user?.role || 'School Admin';
  const canManage = ['School Admin', 'Super Admin', 'Teacher'].includes(role);

  // Filters State
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [eventKindFilter, setEventKindFilter] = useState('All');
  const [eventSearch, setEventSearch] = useState('');

  // API Queries (fetches only published events by default)
  const { data: rawEvents = [], isLoading: eventsLoading } = useGetEventsQuery({
    search: eventSearch.trim() || undefined,
    kind: eventKindFilter !== 'All' ? eventKindFilter : undefined,
    activity_status: activityFilter !== 'all' ? activityFilter : undefined,
  });

  const { data: myRegistrations = [] } = useGetMyRegistrationsQuery();

  // Mutations
  const [createEventMutation, { isLoading: creatingEvent }] = useCreateEventMutation();
  const [updateEventMutation, { isLoading: updatingEvent }] = useUpdateEventMutation();
  const [deleteEventMutation, { isLoading: deletingEvent }] = useDeleteEventMutation();
  const [registerMutation, { isLoading: registering }] = useRegisterForEventMutation();
  const [cancelRegMutation] = useCancelEventRegistrationMutation();
  const [fetchAttendees, { data: attendees = [], isFetching: fetchingAttendees }] = useLazyGetEventRegistrationsQuery();

  // Modals state
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<SchoolEventRecord | null>(null);
  const [deletingEventTarget, setDeletingEventTarget] = useState<SchoolEventRecord | null>(null);
  const [registeringEvent, setRegisteringEvent] = useState<SchoolEventRecord | null>(null);
  const [attendeesEvent, setAttendeesEvent] = useState<SchoolEventRecord | null>(null);
  const [attendeeSearch, setAttendeeSearch] = useState('');

  // Form states
  const [eventForm, setEventForm] = useState<{
    kind: EventKind;
    title: string;
    date: string;
    registration_deadline: string;
    venue: string;
    capacity: number;
    ticket_required: boolean;
    audience: string;
    description: string;
  }>({
    kind: 'School event',
    title: '',
    date: '',
    registration_deadline: '',
    venue: '',
    capacity: 100,
    ticket_required: true,
    audience: 'Teachers, students and parents',
    description: '',
  });

  const [regForm, setRegForm] = useState({
    attendee_name: user?.name || '',
    attendee_email: user?.email || '',
    attendee_phone: '',
    class_name: '',
    section: '',
    roll_no: '',
    notes: '',
  });

  // Client-side filtering & sorting
  const events = useMemo(() => {
    const now = new Date();
    return rawEvents.filter(item => {
      // Ensure only published events are shown
      if (item.status && item.status !== 'Published') return false;

      const isDeadlinePassed =
        item.is_deadline_passed ||
        (item.registration_deadline && now > new Date(item.registration_deadline));

      if (activityFilter === 'active') {
        if (isDeadlinePassed) return false;
      } else if (activityFilter === 'inactive') {
        if (!isDeadlinePassed) return false;
      }

      if (eventKindFilter !== 'All' && item.kind !== eventKindFilter) {
        return false;
      }

      if (eventSearch.trim()) {
        const q = eventSearch.toLowerCase();
        const match =
          item.title.toLowerCase().includes(q) ||
          item.venue.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }, [rawEvents, activityFilter, eventKindFilter, eventSearch]);

  // Counts for Metrics
  const activeCount = useMemo(() => {
    const now = new Date();
    return rawEvents.filter(e => {
      if (e.status && e.status !== 'Published') return false;
      return !e.is_deadline_passed && (!e.registration_deadline || now <= new Date(e.registration_deadline));
    }).length;
  }, [rawEvents]);

  const inactiveCount = useMemo(() => {
    const now = new Date();
    return rawEvents.filter(e => {
      if (e.status && e.status !== 'Published') return false;
      return e.is_deadline_passed || (e.registration_deadline && now > new Date(e.registration_deadline));
    }).length;
  }, [rawEvents]);

  // Filtered Attendees for the modal
  const filteredAttendees = useMemo(() => {
    if (!attendees) return [];
    return attendees.filter(a => {
      if (!attendeeSearch.trim()) return true;
      const q = attendeeSearch.toLowerCase();
      return (
        a.attendee_name.toLowerCase().includes(q) ||
        (a.admission_no && a.admission_no.toLowerCase().includes(q)) ||
        (a.ticket_code && a.ticket_code.toLowerCase().includes(q)) ||
        (a.class_name && a.class_name.toLowerCase().includes(q))
      );
    });
  }, [attendees, attendeeSearch]);

  // Handlers
  const handleOpenCreateEvent = () => {
    setEditingEvent(null);
    const defaultDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const defaultDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    setEventForm({
      kind: 'School event',
      title: '',
      date: formatDateTimeLocal(defaultDate),
      registration_deadline: formatDateTimeLocal(defaultDeadline),
      venue: '',
      capacity: 100,
      ticket_required: true,
      audience: 'Teachers, students and parents',
      description: '',
    });
    setEventModalOpen(true);
  };

  const handleOpenEditEvent = (item: SchoolEventRecord) => {
    setEditingEvent(item);
    setEventForm({
      kind: item.kind,
      title: item.title,
      date: formatDateTimeLocal(new Date(item.date)),
      registration_deadline: item.registration_deadline
        ? formatDateTimeLocal(new Date(item.registration_deadline))
        : '',
      venue: item.venue,
      capacity: item.capacity,
      ticket_required: item.ticket_required,
      audience: item.audience,
      description: item.description || '',
    });
    setEventModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventForm.title.trim() || !eventForm.date || !eventForm.venue.trim()) {
      emitNotification({
        title: 'Validation Error',
        message: 'Please provide event title, date & time, and venue.',
        tone: 'danger',
        source: 'events',
      });
      return;
    }

    if (eventForm.registration_deadline && new Date(eventForm.registration_deadline) > new Date(eventForm.date)) {
      emitNotification({
        title: 'Invalid Registration Deadline',
        message: 'Registration deadline cannot be after the event start date.',
        tone: 'danger',
        source: 'events',
      });
      return;
    }

    try {
      if (editingEvent) {
        await updateEventMutation({
          id: editingEvent.id,
          data: {
            ...eventForm,
            status: 'Published',
            date: new Date(eventForm.date).toISOString(),
            registration_deadline: eventForm.registration_deadline
              ? new Date(eventForm.registration_deadline).toISOString()
              : null,
          },
        }).unwrap();
        emitNotification({
          title: 'Event Updated',
          message: `"${eventForm.title}" has been updated successfully.`,
          tone: 'success',
          source: 'events',
        });
      } else {
        await createEventMutation({
          ...eventForm,
          status: 'Published',
          date: new Date(eventForm.date).toISOString(),
          registration_deadline: eventForm.registration_deadline
            ? new Date(eventForm.registration_deadline).toISOString()
            : null,
        }).unwrap();
        emitNotification({
          title: 'Event Published',
          message: `"${eventForm.title}" is now published and active.`,
          tone: 'success',
          source: 'events',
        });
      }
      setEventModalOpen(false);
    } catch (err: any) {
      emitNotification({
        title: 'Save Failed',
        message: err?.data?.detail || 'Failed to save event.',
        tone: 'danger',
        source: 'events',
      });
    }
  };

  const handleDeleteEventConfirm = async () => {
    if (!deletingEventTarget) return;
    try {
      await deleteEventMutation(deletingEventTarget.id).unwrap();
      emitNotification({
        title: 'Event Deleted',
        message: `"${deletingEventTarget.title}" has been deleted.`,
        tone: 'success',
        source: 'events',
      });
      setDeletingEventTarget(null);
    } catch (err: any) {
      emitNotification({
        title: 'Deletion Failed',
        message: err?.data?.detail || 'Failed to delete event.',
        tone: 'danger',
        source: 'events',
      });
    }
  };

  const handleOpenRegister = (item: SchoolEventRecord) => {
    if (item.registration_deadline && new Date() > new Date(item.registration_deadline)) {
      emitNotification({
        title: 'Registration Closed',
        message: `Registration deadline for "${item.title}" has passed.`,
        tone: 'warning',
        source: 'events',
      });
      return;
    }
    if (item.registered_count >= item.capacity) {
      emitNotification({
        title: 'Event Full',
        message: `"${item.title}" is already at full capacity.`,
        tone: 'warning',
        source: 'events',
      });
      return;
    }
    setRegisteringEvent(item);
    setRegForm({
      attendee_name: user?.name || '',
      attendee_email: user?.email || '',
      attendee_phone: '',
      class_name: '',
      section: '',
      roll_no: '',
      notes: '',
    });
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registeringEvent) return;

    try {
      const payload: any = {
        attendee_name: regForm.attendee_name.trim(),
        attendee_email: regForm.attendee_email.trim(),
        attendee_phone: regForm.attendee_phone.trim(),
        class_name: regForm.class_name.trim(),
        section: regForm.section.trim(),
        notes: regForm.notes.trim(),
      };
      if (regForm.roll_no) {
        payload.roll_no = parseInt(regForm.roll_no, 10);
      }

      const res = await registerMutation({
        eventId: registeringEvent.id,
        data: payload,
      }).unwrap();

      emitNotification({
        title: 'Registration Confirmed!',
        message: `You are registered for "${registeringEvent.title}". Ticket code: ${res.ticket_code}`,
        tone: 'success',
        source: 'events',
      });
      setRegisteringEvent(null);
    } catch (err: any) {
      const errorMsg =
        err?.data?.detail ||
        (typeof err?.data === 'object' ? Object.values(err.data).join(' ') : 'Registration failed.');
      emitNotification({
        title: 'Registration Error',
        message: errorMsg,
        tone: 'danger',
        source: 'events',
      });
    }
  };

  const handleCancelRegistration = async (eventId: number | string, eventTitle: string) => {
    if (!confirm(`Are you sure you want to cancel your registration for "${eventTitle}"?`)) return;
    try {
      await cancelRegMutation(eventId).unwrap();
      emitNotification({
        title: 'Registration Cancelled',
        message: `Your registration for "${eventTitle}" has been cancelled.`,
        tone: 'info',
        source: 'events',
      });
    } catch (err: any) {
      emitNotification({
        title: 'Cancellation Failed',
        message: err?.data?.detail || 'Failed to cancel registration.',
        tone: 'danger',
        source: 'events',
      });
    }
  };

  const handleOpenAttendees = (item: SchoolEventRecord) => {
    setAttendeesEvent(item);
    setAttendeeSearch('');
    fetchAttendees(item.id);
  };

  const handleExportAttendeesCSV = () => {
    if (!attendeesEvent || !attendees.length) return;
    const headers = ['Ticket Code', 'Attendee Name', 'Admission No', 'Class', 'Section', 'Roll No', 'Email', 'Phone', 'Notes', 'Registration Date'];
    const rows = attendees.map(a => [
      `"${a.ticket_code}"`,
      `"${a.attendee_name}"`,
      `"${a.admission_no || ''}"`,
      `"${a.class_name || ''}"`,
      `"${a.section || ''}"`,
      `"${a.roll_no || ''}"`,
      `"${a.attendee_email || ''}"`,
      `"${a.attendee_phone || ''}"`,
      `"${(a.notes || '').replace(/"/g, '""')}"`,
      `"${new Date(a.registered_at).toLocaleString()}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${attendeesEvent.title.replace(/\s+/g, '_')}_Attendees.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section className="space-y-6 animate-fade-in pb-12" id="community-events-module">
      {/* Header Banner */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-900 via-indigo-700 to-cyan-600 px-7 py-8 text-white shadow-xl">
        <Globe2 className="absolute -bottom-10 -right-8 h-56 w-56 text-white/10 pointer-events-none" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-cyan-400/20 px-3 py-1 text-[11px] font-bold uppercase tracking-[.18em] text-cyan-200 backdrop-blur-md">
                Published Events
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white/90">
                {role} View
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-black sm:text-4xl tracking-tight">
              School Events & Programs
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cyan-50/90 font-medium">
              Browse published workshops, competitions, and seminars. Active events accept online registrations until their deadline.
            </p>
          </div>
          {canManage && (
            <div>
              <button
                onClick={handleOpenCreateEvent}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-black text-indigo-700 shadow-lg hover:bg-cyan-50 transition-all hover:scale-105 active:scale-95"
              >
                <Plus className="h-4 w-4" />
                Post an Event
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div
          onClick={() => setActivityFilter('all')}
          className={`cursor-pointer rounded-2xl border p-5 transition-all shadow-sm ${
            activityFilter === 'all'
              ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20'
              : 'bg-white border-slate-200/80 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="inline-flex rounded-xl p-2.5 bg-indigo-50 text-indigo-600 border border-indigo-100">
              <CalendarDays className="h-5 w-5" />
            </div>
            <span className="text-2xl font-black text-slate-900">{rawEvents.length}</span>
          </div>
          <p className="mt-3 text-xs font-bold text-slate-800">All Published Events</p>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">Total scheduled programs</p>
        </div>

        <div
          onClick={() => setActivityFilter('active')}
          className={`cursor-pointer rounded-2xl border p-5 transition-all shadow-sm ${
            activityFilter === 'active'
              ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-500/20'
              : 'bg-white border-slate-200/80 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="inline-flex rounded-xl p-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <span className="text-2xl font-black text-emerald-700">{activeCount}</span>
          </div>
          <p className="mt-3 text-xs font-bold text-slate-800">Active Events</p>
          <p className="text-[11px] text-emerald-600 font-bold mt-0.5">Registration is currently open</p>
        </div>

        <div
          onClick={() => setActivityFilter('inactive')}
          className={`cursor-pointer rounded-2xl border p-5 transition-all shadow-sm ${
            activityFilter === 'inactive'
              ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-500/20'
              : 'bg-white border-slate-200/80 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="inline-flex rounded-xl p-2.5 bg-rose-50 text-rose-600 border border-rose-100">
              <Clock className="h-5 w-5" />
            </div>
            <span className="text-2xl font-black text-rose-700">{inactiveCount}</span>
          </div>
          <p className="mt-3 text-xs font-bold text-slate-800">In-active Events</p>
          <p className="text-[11px] text-rose-600 font-medium mt-0.5">Deadline passed / Registration closed</p>
        </div>
      </div>

      {/* Filter Toolbar & Status Filter Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
        {/* Active vs In-active Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setActivityFilter('all')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-black transition-all ${
              activityFilter === 'all'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Events ({rawEvents.length})
          </button>
          <button
            onClick={() => setActivityFilter('active')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-black transition-all ${
              activityFilter === 'active'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Active Events ({activeCount})
          </button>
          <button
            onClick={() => setActivityFilter('inactive')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-black transition-all ${
              activityFilter === 'inactive'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-rose-700 hover:bg-rose-50'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            In-active Events ({inactiveCount})
          </button>
        </div>

        {/* Search & Category Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search published events..."
              value={eventSearch}
              onChange={e => setEventSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-medium focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <select
            value={eventKindFilter}
            onChange={e => setEventKindFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-none"
          >
            <option value="All">All Categories</option>
            <option value="School event">School events</option>
            <option value="Workshop">Workshops</option>
            <option value="Competition">Competitions</option>
            <option value="Seminar">Seminars</option>
            <option value="Sports">Sports</option>
            <option value="Cultural">Cultural</option>
          </select>
        </div>
      </div>

      {/* Events Grid */}
      {eventsLoading ? (
        <div className="py-16 text-center text-sm font-semibold text-slate-400">Loading published events...</div>
      ) : events.length === 0 ? (
        <Empty
          icon={<CalendarDays className="h-10 w-10" />}
          text={
            activityFilter === 'active'
              ? 'No active published events open for registration right now.'
              : activityFilter === 'inactive'
              ? 'No in-active or past events found.'
              : 'No published events found matching your search. Click "+ Post an Event" above to add one.'
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {events.map(item => {
            const isRegistered = item.is_registered || myRegistrations.some(r => r.event === item.id);
            const isDeadlinePassed =
              item.is_deadline_passed ||
              (item.registration_deadline && new Date() > new Date(item.registration_deadline));
            const isFull = item.registered_count >= item.capacity;
            const canRegister = !isRegistered && !isDeadlinePassed && !isFull;

            return (
              <article
                key={item.id}
                className="flex flex-col rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm hover:shadow-md transition-all hover:border-indigo-200 relative group"
              >
                {/* Top Kind & Admin Actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-violet-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-violet-700 border border-violet-100">
                      {item.kind}
                    </span>
                    {isDeadlinePassed ? (
                      <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700 border border-rose-200">
                        In-active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.ticket_required && (
                      <span
                        title="Ticket Required"
                        className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200/60"
                      >
                        <Ticket className="h-3 w-3 text-amber-500" /> Pass
                      </span>
                    )}
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEditEvent(item)}
                          title="Edit Event"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeletingEventTarget(item)}
                          title="Delete Event"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title & Description */}
                <h3 className="mt-3.5 text-lg font-extrabold text-slate-900 leading-snug">
                  {item.title}
                </h3>
                <p className="mt-2 min-h-11 text-xs leading-relaxed text-slate-600 line-clamp-3">
                  {item.description || 'Join us for this exciting school program.'}
                </p>

                {/* Event Schedule & Deadline Details */}
                <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-3.5 border border-slate-100 text-xs font-semibold text-slate-600">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Calendar className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span>
                      {new Date(item.date).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700">
                    <MapPin className="h-4 w-4 text-cyan-500 shrink-0" />
                    <span className="truncate">{item.venue}</span>
                  </div>

                  {/* Deadline Display */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[11px]">
                    <span className="flex items-center gap-1.5 font-bold text-slate-500">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      Registration Deadline:
                    </span>
                    {item.registration_deadline ? (
                      <span
                        className={`font-black ${
                          isDeadlinePassed ? 'text-rose-600' : 'text-slate-800'
                        }`}
                      >
                        {new Date(item.registration_deadline).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-medium">Until event date</span>
                    )}
                  </div>

                  {/* Capacity Progress Bar */}
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[11px] font-bold text-slate-500">
                      <span>Registration spots</span>
                      <span className="text-slate-800">
                        {item.registered_count} / {item.capacity}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isFull ? 'bg-rose-500' : 'bg-indigo-600'
                        }`}
                        style={{
                          width: `${Math.min(100, (item.registered_count / item.capacity) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Status Alert */}
                <div className="mt-3">
                  {isRegistered ? (
                    <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-800 border border-emerald-200">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Registered
                      </span>
                      {item.my_ticket_code && (
                        <span className="font-mono text-[11px] text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-200 font-bold">
                          {item.my_ticket_code}
                        </span>
                      )}
                    </div>
                  ) : isDeadlinePassed ? (
                    <div className="flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 border border-rose-200">
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                      <span>Registration closed (Deadline date passed)</span>
                    </div>
                  ) : isFull ? (
                    <div className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 border border-amber-200">
                      <Users className="h-4 w-4 text-amber-600" />
                      Registration full (Capacity reached)
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Open for registrations
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-4 pt-2 border-t border-slate-100 flex items-center gap-2">
                  {canManage && (
                    <button
                      onClick={() => handleOpenAttendees(item)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 py-2.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 transition-all"
                    >
                      <Users className="h-4 w-4" />
                      Attendees ({item.registered_count})
                    </button>
                  )}

                  {canRegister ? (
                    <button
                      onClick={() => handleOpenRegister(item)}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white hover:bg-indigo-700 shadow-sm transition-all hover:scale-[1.02] active:scale-98"
                    >
                      <Ticket className="h-4 w-4" />
                      {item.ticket_required ? 'Register & get ticket' : 'Register now'}
                    </button>
                  ) : isRegistered ? (
                    <button
                      onClick={() => handleCancelRegistration(item.id, item.title)}
                      className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      disabled
                      className="flex-1 inline-flex items-center justify-center rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-400 cursor-not-allowed"
                    >
                      {isDeadlinePassed ? 'Closed' : 'Full'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* --- MODALS --- */}

      {/* 1. Create / Edit Event Modal */}
      {eventModalOpen && (
        <Modal
          title={editingEvent ? 'Edit school event' : 'Post a new event'}
          close={() => setEventModalOpen(false)}
        >
          <form onSubmit={handleSaveEvent} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Event category
                </label>
                <select
                  value={eventForm.kind}
                  onChange={e => setEventForm({ ...eventForm, kind: e.target.value as EventKind })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-bold focus:border-indigo-500 focus:outline-none"
                >
                  <option value="School event">School event</option>
                  <option value="Workshop">Workshop</option>
                  <option value="Competition">Competition</option>
                  <option value="Seminar">Seminar</option>
                  <option value="Sports">Sports</option>
                  <option value="Cultural">Cultural</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Target audience
                </label>
                <select
                  value={eventForm.audience}
                  onChange={e => setEventForm({ ...eventForm, audience: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-bold focus:border-indigo-500 focus:outline-none"
                >
                  <option value="Teachers, students and parents">Teachers, students and parents</option>
                  <option value="Students only">Students only</option>
                  <option value="Teachers only">Teachers only</option>
                  <option value="Parents only">Parents only</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Event title <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                placeholder="e.g. Annual Inter-House Debate Championship"
                value={eventForm.title}
                onChange={e => setEventForm({ ...eventForm, title: e.target.value })}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Event date & time <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="datetime-local"
                  value={eventForm.date}
                  onChange={e => setEventForm({ ...eventForm, date: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Registration deadline <span className="text-indigo-600 font-bold">(Stops registrations)</span>
                </label>
                <input
                  type="datetime-local"
                  value={eventForm.registration_deadline}
                  onChange={e => setEventForm({ ...eventForm, registration_deadline: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Registration will automatically stop when this date/time is reached.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Venue / Location <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Main Auditorium / Innovation Lab"
                  value={eventForm.venue}
                  onChange={e => setEventForm({ ...eventForm, venue: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Max capacity (Seats) <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="number"
                  min="1"
                  value={eventForm.capacity}
                  onChange={e => setEventForm({ ...eventForm, capacity: parseInt(e.target.value, 10) || 100 })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Description & Agenda
              </label>
              <textarea
                rows={3}
                placeholder="Details, instructions, eligibility, and rules..."
                value={eventForm.description}
                onChange={e => setEventForm({ ...eventForm, description: e.target.value })}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-extrabold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={eventForm.ticket_required}
                onChange={e => setEventForm({ ...eventForm, ticket_required: e.target.checked })}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
              Generate unique digital ticket code on registration (e.g. SCH-A44C97)
            </label>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingEvent || updatingEvent}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                {creatingEvent || updatingEvent ? 'Saving...' : editingEvent ? 'Update Event' : 'Publish Event'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* 2. Delete Confirmation Modal */}
      {deletingEventTarget && (
        <Modal title="Confirm Delete Event" close={() => setDeletingEventTarget(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Are you sure you want to delete <span className="font-extrabold text-slate-900">"{deletingEventTarget.title}"</span>?
            </p>
            <p className="text-xs text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-200 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>This will remove the event and all associated student registrations and issued tickets permanently.</span>
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setDeletingEventTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteEventConfirm}
                disabled={deletingEvent}
                className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deletingEvent ? 'Deleting...' : 'Delete Event'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 3. Student Registration Form Modal */}
      {registeringEvent && (
        <Modal
          title={`Register: ${registeringEvent.title}`}
          close={() => setRegisteringEvent(null)}
        >
          <form onSubmit={handleSubmitRegistration} className="space-y-4">
            <div className="rounded-2xl bg-indigo-50/80 p-3.5 border border-indigo-100 text-xs text-indigo-900 space-y-1">
              <p className="font-black text-sm">{registeringEvent.title}</p>
              <p className="text-indigo-700 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span>{new Date(registeringEvent.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </p>
              <p className="text-indigo-700 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>{registeringEvent.venue}</span>
              </p>
              {registeringEvent.registration_deadline && (
                <p className="text-amber-700 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Registration Deadline: {new Date(registeringEvent.registration_deadline).toLocaleString([], {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Attendee / Student Name <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  value={regForm.attendee_name}
                  onChange={e => setRegForm({ ...regForm, attendee_name: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Contact Email <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="email"
                  value={regForm.attendee_email}
                  onChange={e => setRegForm({ ...regForm, attendee_email: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Class / Grade
                </label>
                <input
                  type="text"
                  placeholder="e.g. Grade 10"
                  value={regForm.class_name}
                  onChange={e => setRegForm({ ...regForm, class_name: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Section
                </label>
                <input
                  type="text"
                  placeholder="e.g. A"
                  value={regForm.section}
                  onChange={e => setRegForm({ ...regForm, section: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Roll No
                </label>
                <input
                  type="number"
                  placeholder="e.g. 15"
                  value={regForm.roll_no}
                  onChange={e => setRegForm({ ...regForm, roll_no: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Contact Phone / Parent Phone
              </label>
              <input
                type="tel"
                placeholder="+1..."
                value={regForm.attendee_phone}
                onChange={e => setRegForm({ ...regForm, attendee_phone: e.target.value })}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Special notes / requirements (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="Any special accommodations, dietary preferences, or questions..."
                value={regForm.notes}
                onChange={e => setRegForm({ ...regForm, notes: e.target.value })}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-medium focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRegisteringEvent(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={registering}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                <Ticket className="h-4 w-4" />
                {registering ? 'Confirming...' : 'Confirm Registration'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* 4. Registered Students / Attendees Roster Modal (Admin/Teacher View) */}
      {attendeesEvent && (
        <Modal
          title={`Registered Attendees - ${attendeesEvent.title}`}
          close={() => setAttendeesEvent(null)}
          large
        >
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <div className="text-xs text-slate-600">
                <span className="font-bold text-slate-900">{attendeesEvent.registered_count}</span> registered out of{' '}
                <span className="font-bold text-slate-900">{attendeesEvent.capacity}</span> total capacity
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search attendee / code..."
                    value={attendeeSearch}
                    onChange={e => setAttendeeSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleExportAttendeesCSV}
                  disabled={!attendees.length}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Export CSV
                </button>
              </div>
            </div>

            {fetchingAttendees ? (
              <div className="py-12 text-center text-sm font-semibold text-slate-400">Loading attendee list...</div>
            ) : filteredAttendees.length === 0 ? (
              <Empty
                icon={<Users className="h-8 w-8" />}
                text={attendeeSearch ? 'No attendees match the search filter.' : 'No students have registered for this event yet.'}
              />
            ) : (
              <div className="overflow-x-auto max-h-[55vh] rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-extrabold uppercase text-[10px] tracking-wider sticky top-0">
                    <tr>
                      <th className="p-3">Ticket Code</th>
                      <th className="p-3">Attendee Name</th>
                      <th className="p-3">Admission / Roll</th>
                      <th className="p-3">Class & Section</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Registration Date</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-medium text-slate-700">
                    {filteredAttendees.map(a => (
                      <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-bold text-indigo-600">{a.ticket_code}</td>
                        <td className="p-3 font-extrabold text-slate-900">{a.attendee_name}</td>
                        <td className="p-3">
                          {a.admission_no || '—'} {a.roll_no ? `(Roll: ${a.roll_no})` : ''}
                        </td>
                        <td className="p-3">
                          {a.class_name ? `${a.class_name} ${a.section ? `(${a.section})` : ''}` : '—'}
                        </td>
                        <td className="p-3 text-[11px]">
                          <div>{a.attendee_email}</div>
                          {a.attendee_phone && <div className="text-slate-400">{a.attendee_phone}</div>}
                        </td>
                        <td className="p-3 text-[11px] text-slate-500">
                          {new Date(a.registered_at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="p-3">
                          <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setAttendeesEvent(null)}
                className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// Helpers & Subcomponents
function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : n);
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-12 text-center text-xs leading-relaxed text-slate-500">
      <span className="mx-auto mb-3 block w-fit text-indigo-400">{icon}</span>
      {text}
    </div>
  );
}

function Modal({
  title,
  close,
  children,
  large,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  large?: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
      <div
        className={`max-h-[85vh] my-auto w-full ${
          large ? 'max-w-3xl' : 'max-w-xl'
        } flex flex-col rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 overflow-hidden animate-scale-in`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-modal-title"
      >
        <div className="flex-shrink-0 mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 id="event-modal-title" className="text-lg font-black text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
