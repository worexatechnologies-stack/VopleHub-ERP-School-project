import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen, Trophy, PlayCircle, FileText, CheckCircle2,
  ArrowLeft, Brain, BookMarked, Award, Lock, LogIn,
  X, CheckCircle, ShieldCheck, Star, User, CreditCard,
  Smartphone, Coins, Phone, Compass, Check, AlertCircle, Zap, GraduationCap
} from 'lucide-react';
import { COMPETITIVE_EXAMS, PRACTICE_TESTS, ONLINE_COURSES } from '../data/mockData';
import { PublicLearnerRecord } from '../types';

interface PublicLearningModuleProps {
  onExit: () => void;
}

// Pricing constants
const PLAN_DETAILS = {
  Monthly:   { price: 299,  duration: '1 Month',   savings: '' },
  Quarterly: { price: 799,  duration: '3 Months',  savings: 'Save ₹98' },
  Annual:    { price: 2499, duration: '12 Months', savings: 'Best Value' },
};

function loadLearners(): PublicLearnerRecord[] {
  try {
    const saved = localStorage.getItem('sa_public_learners');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveLearners(learners: PublicLearnerRecord[]) {
  localStorage.setItem('sa_public_learners', JSON.stringify(learners));
}

function getExpiryDate(plan: 'Monthly' | 'Quarterly' | 'Annual'): string {
  const d = new Date();
  if (plan === 'Monthly') d.setMonth(d.getMonth() + 1);
  else if (plan === 'Quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

// ────────────────────────────────────────────────────────────────────────────
// Design tokens (matches glassmorphic main theme)
// ────────────────────────────────────────────────────────────────────────────
const g = {
  // Cards
  card:        'bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl',
  cardHover:   'hover:bg-white/10 hover:border-white/20 transition-all duration-300',
  cardInner:   'bg-white/5 border border-white/8 rounded-xl',
  // Input
  input:       'w-full bg-white/5 border border-white/10 focus:border-indigo-500/60 focus:bg-white/8 rounded-xl p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none transition-all',
  // Label
  label:       'text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5',
  // Button
  btnPrimary:  'w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg shadow-indigo-500/20',
  btnSuccess:  'w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-500/20',
  btnGhost:    'px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer',
  // Text
  heading:     'font-black text-white tracking-tight',
  subtext:     'text-slate-400 text-xs',
  badge:       'text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider',
};

export default function PublicLearningModule({ onExit }: PublicLearningModuleProps) {
  const [activeTab, setActiveTab] = useState<'tutorials' | 'competitive' | 'practice'>('tutorials');
  const [selectedExam, setSelectedExam] = useState<string | null>(null);

  // Practice Test State
  const [activeTest, setActiveTest] = useState<any | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [key: number]: number }>({});
  const [testSubmitted, setTestSubmitted] = useState(false);

  // Video player state
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  // Auth Modal
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'payment'>('login');

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Signup fields
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPlan, setSignupPlan] = useState<'Monthly' | 'Quarterly' | 'Annual'>('Monthly');

  // Payment sim
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'success'>('idle');
  const [paymentUpiId, setPaymentUpiId] = useState('');
  const [paymentCardNum, setPaymentCardNum] = useState('');

  // Subscriber
  const [subscriber, setSubscriber] = useState<PublicLearnerRecord | null>(null);

  useEffect(() => {
    const savedSession = sessionStorage.getItem('active_public_learner');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        const today = new Date().toISOString().split('T')[0];
        if (parsed.expiryDate >= today && parsed.status === 'Active') {
          setSubscriber(parsed);
        } else {
          sessionStorage.removeItem('active_public_learner');
        }
      } catch { /* ignore */ }
    }
  }, []);

  // ── Auth Handlers ──────────────────────────────────────────────────────────
  const handleSubscriberLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const learners = loadLearners();
    const match = learners.find(
      l => l.email.toLowerCase() === loginEmail.toLowerCase() && l.password === loginPassword
    );
    if (!match) { setLoginError('Invalid Email ID or Password. Please try again.'); return; }
    const today = new Date().toISOString().split('T')[0];
    if (match.expiryDate < today) {
      setLoginError('Your subscription expired on ' + match.expiryDate + '. Please register a new subscription.');
      return;
    }
    if (match.status === 'Suspended') {
      setLoginError('Your access has been suspended by the administrator.');
      return;
    }
    setSubscriber(match);
    sessionStorage.setItem('active_public_learner', JSON.stringify(match));
    setShowAuthModal(false);
    setLoginEmail(''); setLoginPassword('');
  };

  const handleRegisterClick = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const learners = loadLearners();
    const conflict = learners.some(l => l.email.toLowerCase() === signupEmail.toLowerCase() && l.status === 'Active');
    if (conflict) {
      setLoginError('This email is already registered and active. Please log in.');
      setAuthMode('login');
      return;
    }
    setAuthMode('payment');
  };

  const handleSimulatePayment = () => {
    setPaymentStatus('processing');
    setTimeout(() => {
      setPaymentStatus('success');
      setTimeout(() => {
        const expiryDate = getExpiryDate(signupPlan);
        const newLearner: PublicLearnerRecord = {
          id: 'pl-' + Math.random().toString(36).substr(2, 9),
          name: signupName, email: signupEmail, password: signupPassword,
          plan: signupPlan, status: 'Active',
          paymentDate: new Date().toISOString().split('T')[0],
          expiryDate, phone: signupPhone,
          notes: 'Self-Registered & Paid Online via Portal Gateway',
        };
        saveLearners([newLearner, ...loadLearners()]);
        setSubscriber(newLearner);
        sessionStorage.setItem('active_public_learner', JSON.stringify(newLearner));
        setShowAuthModal(false);
        setAuthMode('login');
        setPaymentStatus('idle');
        setSignupName(''); setSignupEmail(''); setSignupPassword(''); setSignupPhone('');
        setSignupPlan('Monthly');
      }, 1500);
    }, 2000);
  };

  const handleLogoutSubscriber = () => {
    setSubscriber(null);
    sessionStorage.removeItem('active_public_learner');
  };

  const openSubscribe = (mode: 'login' | 'signup' = 'signup') => {
    setAuthMode(mode);
    setShowAuthModal(true);
  };

  // ── Practice Test Handlers ─────────────────────────────────────────────────
  const startTest = (testId: string) => {
    if (!subscriber) { openSubscribe('signup'); return; }
    const test = PRACTICE_TESTS.find(t => t.id === testId);
    if (test) {
      setActiveTest(test);
      setCurrentQuestionIndex(0);
      setSelectedAnswers({});
      setTestSubmitted(false);
    }
  };

  const handleAnswerSelect = (optionIndex: number) => {
    if (testSubmitted) return;
    setSelectedAnswers(prev => ({ ...prev, [currentQuestionIndex]: optionIndex }));
  };

  const calculateScore = () =>
    activeTest.questions.reduce((score: number, q: any, index: number) =>
      selectedAnswers[index] === q.correctIndex ? score + 1 : score, 0);

  const isPremium = !!subscriber;

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col font-sans relative">

      {/* ── Ambient Glows (same as main app) ──────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-indigo-600/8 rounded-full blur-[140px]" />
        <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[160px]" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-violet-600/5 rounded-full blur-[120px]" />
      </div>

      {/* ── Top Header ────────────────────────────────────────────────────── */}
      <header className="bg-slate-900/50 backdrop-blur-xl border-b border-white/8 px-6 py-4 sticky top-0 z-30 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20"
               style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2">
              Public Learning Portal
              <span className="text-[9px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Self Service</span>
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">Free preview &amp; premium subscription learning hub</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {subscriber ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 rounded-xl">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="hidden md:block text-left">
                <p className="text-xs font-bold text-emerald-300">{subscriber.name}</p>
                <p className="text-[9px] text-emerald-400/70 font-mono">Premium until {subscriber.expiryDate}</p>
              </div>
              <button onClick={handleLogoutSubscriber} className="ml-1 text-emerald-400 hover:text-white p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer" title="Sign Out">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => openSubscribe('signup')}
              className="flex items-center gap-2 text-white px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              Subscribe / Sign Up
            </button>
          )}

          <button
            onClick={onExit}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back to ERP</span>
          </button>
        </div>
      </header>

      {/* ── Auth / Payment Modal ───────────────────────────────────────────── */}
      {showAuthModal && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black/70 backdrop-blur-md flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-scaleUp flex flex-col max-h-[85vh] my-auto">

            {/* Close */}
            {paymentStatus !== 'processing' && (
              <button
                onClick={() => { setShowAuthModal(false); setLoginError(''); setPaymentStatus('idle'); }}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer z-10"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            {/* Tab toggle (login / signup) */}
            {authMode !== 'payment' && (
              <div className="flex border-b border-white/8 shrink-0">
                {(['login', 'signup'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { setAuthMode(mode); setLoginError(''); }}
                    className={`flex-1 py-4 text-center text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
                      authMode === mode
                        ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {mode === 'login' ? 'Sign In' : 'Create Account'}
                  </button>
                ))}
              </div>
            )}

            <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">

              {/* ── LOGIN ── */}
              {authMode === 'login' && (
                <>
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
                      <ShieldCheck className="w-7 h-7 text-indigo-400" />
                    </div>
                    <h3 className="text-lg font-black text-white">Welcome Back, Subscriber</h3>
                    <p className="text-xs text-slate-400 mt-1">Sign in to unlock all premium modules</p>
                  </div>

                  <form onSubmit={handleSubscriberLogin} className="space-y-4">
                    <div>
                      <label className={g.label}>Registered Email (User ID)</label>
                      <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                        placeholder="learner@email.com" required className={g.input} />
                    </div>
                    <div>
                      <label className={g.label}>Password</label>
                      <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                        placeholder="••••••••" required className={g.input} />
                    </div>

                    {loginError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold rounded-xl flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{loginError}</span>
                      </div>
                    )}

                    <button type="submit" className={g.btnPrimary}>Unlock Premium Access</button>
                  </form>
                </>
              )}

              {/* ── SIGNUP ── */}
              {authMode === 'signup' && (
                <>
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
                      <Zap className="w-7 h-7 text-amber-400" />
                    </div>
                    <h3 className="text-lg font-black text-white">Create Premium Account</h3>
                    <p className="text-xs text-slate-400 mt-1">Self-register and pay to activate instantly</p>
                  </div>

                  <form onSubmit={handleRegisterClick} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={g.label}>Full Name</label>
                        <input value={signupName} onChange={e => setSignupName(e.target.value)}
                          placeholder="e.g. Priya Nair" required className={g.input} />
                      </div>
                      <div>
                        <label className={g.label}>Mobile</label>
                        <input value={signupPhone} onChange={e => setSignupPhone(e.target.value)}
                          placeholder="+91 98765 43210" className={g.input} />
                      </div>
                    </div>
                    <div>
                      <label className={g.label}>Email Address (Login ID)</label>
                      <input type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
                        placeholder="learner@email.com" required className={g.input} />
                    </div>
                    <div>
                      <label className={g.label}>Password</label>
                      <input type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)}
                        placeholder="Choose a strong password" required className={g.input} />
                    </div>

                    {/* Plan Selection */}
                    <div>
                      <label className={g.label}>Subscription Plan</label>
                      <div className="grid grid-cols-3 gap-3">
                        {(Object.keys(PLAN_DETAILS) as Array<keyof typeof PLAN_DETAILS>).map(planKey => {
                          const details = PLAN_DETAILS[planKey];
                          const selected = signupPlan === planKey;
                          return (
                            <button
                              key={planKey}
                              type="button"
                              onClick={() => setSignupPlan(planKey)}
                              className={`p-3.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                                selected
                                  ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/10'
                                  : 'bg-white/5 border-white/10 hover:border-white/20'
                              }`}
                            >
                              <span className={`text-[10px] font-bold ${selected ? 'text-indigo-300' : 'text-slate-400'}`}>{planKey}</span>
                              <span className="text-sm font-black text-white">₹{details.price}</span>
                              <span className="text-[9px] text-slate-500">{details.duration}</span>
                              {details.savings && <span className="text-[9px] text-emerald-400 font-bold">{details.savings}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {loginError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold rounded-xl flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" /><span>{loginError}</span>
                      </div>
                    )}

                    <button type="submit" className={g.btnPrimary + ' flex items-center justify-center gap-2'}>
                      <Coins className="w-4 h-4" />
                      Proceed to Payment (₹{PLAN_DETAILS[signupPlan].price})
                    </button>
                  </form>
                </>
              )}

              {/* ── PAYMENT GATEWAY ── */}
              {authMode === 'payment' && (
                <div className="space-y-5">
                  {paymentStatus === 'idle' && (
                    <>
                      {/* Order Summary */}
                      <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center justify-between">
                        <div>
                          <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Order Summary</p>
                          <h4 className="text-sm font-black text-white mt-1">{signupPlan} Premium Plan</h4>
                          <p className="text-[10px] text-slate-400">Auto-activation on payment verification</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500 line-through">₹{Math.round(PLAN_DETAILS[signupPlan].price * 1.3)}</p>
                          <p className="text-lg font-black text-emerald-400">₹{PLAN_DETAILS[signupPlan].price}</p>
                        </div>
                      </div>

                      {/* Payment Methods */}
                      <div>
                        <label className={g.label}>Payment Method</label>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { id: 'upi', label: 'UPI / QR', icon: Smartphone },
                            { id: 'card', label: 'Card', icon: CreditCard },
                            { id: 'netbanking', label: 'Net Banking', icon: Coins },
                          ].map(method => {
                            const Icon = method.icon;
                            const active = paymentMethod === method.id as any;
                            return (
                              <button
                                key={method.id}
                                onClick={() => setPaymentMethod(method.id as any)}
                                className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-[10px] font-bold transition-all cursor-pointer ${
                                  active
                                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
                                    : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                                }`}
                              >
                                <Icon className="w-5 h-5" />
                                {method.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Payment Input */}
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                        {paymentMethod === 'upi' && (
                          <>
                            <label className={g.label}>UPI ID</label>
                            <input value={paymentUpiId} onChange={e => setPaymentUpiId(e.target.value)}
                              placeholder="e.g. mobile@ybl, name@upi" className={g.input} />
                            <p className="text-[9px] text-slate-500">Supports PhonePe, GPay, Paytm, BHIM UPI.</p>
                          </>
                        )}
                        {paymentMethod === 'card' && (
                          <>
                            <label className={g.label}>Card Number</label>
                            <input value={paymentCardNum} onChange={e => setPaymentCardNum(e.target.value)}
                              placeholder="4111 2222 3333 4444" maxLength={19} className={g.input} />
                            <div className="grid grid-cols-2 gap-3">
                              <input placeholder="MM/YY" className={g.input} />
                              <input placeholder="CVV" type="password" maxLength={3} className={g.input} />
                            </div>
                          </>
                        )}
                        {paymentMethod === 'netbanking' && (
                          <>
                            <label className={g.label}>Select Bank</label>
                            <select className={g.input + ' bg-slate-900'}>
                              <option>State Bank of India (SBI)</option>
                              <option>HDFC Bank</option>
                              <option>ICICI Bank</option>
                              <option>Axis Bank</option>
                              <option>Kotak Mahindra Bank</option>
                            </select>
                          </>
                        )}
                      </div>

                      <button onClick={handleSimulatePayment} className={g.btnSuccess + ' flex items-center justify-center gap-2'}>
                        <ShieldCheck className="w-4 h-4" />
                        Simulate Secure Payment (₹{PLAN_DETAILS[signupPlan].price})
                      </button>
                    </>
                  )}

                  {paymentStatus === 'processing' && (
                    <div className="py-14 flex flex-col items-center gap-5">
                      <div className="w-14 h-14 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <div className="text-center">
                        <h4 className="text-sm font-bold text-slate-200">Processing Secure Payment</h4>
                        <p className="text-xs text-slate-400 mt-1">Authorizing with payment servers...</p>
                      </div>
                    </div>
                  )}

                  {paymentStatus === 'success' && (
                    <div className="py-14 flex flex-col items-center gap-5 animate-scaleUp">
                      <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center">
                        <Check className="w-8 h-8 text-emerald-400" />
                      </div>
                      <div className="text-center">
                        <h4 className="text-base font-black text-emerald-400">Payment Verified!</h4>
                        <p className="text-xs text-slate-400 mt-1">Setting up your premium profile...</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8 relative z-10">

        {/* Premium Upgrade Banner (free users only) */}
        {!isPremium && (
          <div className="relative overflow-hidden rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
               style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 50%, #064e3b 100%)' }}>
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
              <div className="absolute -top-10 right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-20 w-32 h-32 bg-emerald-500/8 rounded-full blur-2xl" />
            </div>
            <div className="relative z-10 space-y-2">
              <span className="inline-flex items-center gap-1 text-[9px] bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                <Zap className="w-3 h-3 text-amber-400 inline" /> Limited Free Preview
              </span>
              <h3 className="text-lg font-black text-white">Unlock All Competitive Syllabi &amp; Mock Tests</h3>
              <p className="text-xs text-slate-400 max-w-xl">
                Get full video classes, study notes, and the timed practice test engine. Self-register in 60 seconds — instant activation.
              </p>
            </div>
            <button
              onClick={() => openSubscribe('signup')}
              className="relative z-10 flex items-center gap-2 text-white px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 cursor-pointer shadow-lg hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
            >
              <Coins className="w-4 h-4" />
              Subscribe from ₹299
            </button>
          </div>
        )}

        {/* Premium Active Banner */}
        {isPremium && (
          <div className="relative overflow-hidden rounded-2xl p-5 flex items-center gap-4 bg-emerald-500/8 border border-emerald-500/20">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-black text-emerald-300">Premium Active — {subscriber?.plan} Plan</p>
              <p className="text-[11px] text-emerald-400/70">Welcome back, {subscriber?.name}! Access expires {subscriber?.expiryDate}.</p>
            </div>
          </div>
        )}

        {/* ── Nav Tabs ──────────────────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="inline-flex bg-white/5 border border-white/10 backdrop-blur-sm p-1.5 rounded-2xl gap-1">
            {[
              { id: 'tutorials',   label: 'Home Tutorials',    icon: Brain },
              { id: 'competitive', label: 'Competitive Exams', icon: Trophy },
              { id: 'practice',    label: 'Practice Tests',    icon: CheckCircle2 },
            ].map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id as any); setActiveTest(null); setSelectedExam(null); }}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            TAB: HOME TUTORIALS
            ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'tutorials' && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center">
              <h2 className="text-2xl font-black text-white">Subject Wise Home Tutorials</h2>
              <p className="text-sm text-slate-400 mt-1">Classroom-grade lecture videos and structured preparation materials</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Video Player */}
              <div className="lg:col-span-2">
                <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden aspect-video flex items-center justify-center relative">
                  {isPremium && playingVideo ? (
                    <video src={playingVideo} controls autoPlay className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center p-8 space-y-4">
                      {isPremium ? (
                        <>
                          <div className="w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto">
                            <PlayCircle className="w-8 h-8 text-indigo-400 animate-pulse" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm text-slate-200">Ready to Stream</h3>
                            <p className="text-xs text-slate-400 mt-1">Select a lesson from the playlist →</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center mx-auto">
                            <Lock className="w-8 h-8 text-amber-400" />
                          </div>
                          <div>
                            <h3 className="font-black text-sm text-slate-200">Premium Content Locked</h3>
                            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Subscribe to access all video lessons &amp; notes.</p>
                          </div>
                          <button onClick={() => openSubscribe('signup')}
                            className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs px-5 py-2.5 rounded-xl transition-all cursor-pointer">
                            Subscribe &amp; Access All
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Course Playlist */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-5 rounded-2xl h-[420px] flex flex-col">
                <h3 className="font-bold text-slate-200 mb-3 flex items-center gap-2 border-b border-white/8 pb-3 shrink-0 text-sm">
                  <BookMarked className="w-4 h-4 text-indigo-400" />
                  Subject Lectures
                </h3>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {ONLINE_COURSES.map(course => (
                    <div
                      key={course.id}
                      onClick={() => {
                        if (!isPremium) { openSubscribe('signup'); return; }
                        if (course.type === 'video') setPlayingVideo(course.url);
                      }}
                      className={`p-3 rounded-xl border flex gap-3 items-start cursor-pointer transition-all ${
                        isPremium
                          ? 'bg-white/5 border-white/8 hover:border-indigo-500/40 hover:bg-indigo-500/5'
                          : 'bg-white/3 border-white/5 opacity-60 hover:opacity-80'
                      }`}
                    >
                      <div className={`p-2 rounded-lg shrink-0 ${course.type === 'video' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {isPremium
                          ? (course.type === 'video' ? <PlayCircle className="w-4 h-4" /> : <FileText className="w-4 h-4" />)
                          : <Lock className="w-4 h-4 text-slate-500" />}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-300 leading-tight">{course.title}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{course.subject} • {course.duration || 'PDF'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB: COMPETITIVE EXAMS
            ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'competitive' && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center">
              <h2 className="text-2xl font-black text-white">State &amp; National Competitive Exams</h2>
              <p className="text-sm text-slate-400 mt-1">Targeted syllabi, resources, and guides for KPSC, PSI, FDA, UPSC &amp; more</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {COMPETITIVE_EXAMS.map(exam => (
                <button
                  key={exam.id}
                  onClick={() => setSelectedExam(exam.id)}
                  className={`p-4 rounded-2xl border text-left transition-all duration-300 cursor-pointer group ${
                    selectedExam === exam.id
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl shadow-indigo-500/20 -translate-y-1'
                      : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/8 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="text-2xl block mb-2">{exam.badge}</span>
                  <h3 className="font-black text-sm">{exam.examName}</h3>
                  <p className={`text-[10px] mt-1 line-clamp-1 ${selectedExam === exam.id ? 'text-indigo-100' : 'text-slate-500'}`}>
                    {exam.level}
                  </p>
                </button>
              ))}
            </div>

            {selectedExam && (
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl animate-fade-in space-y-6">
                {COMPETITIVE_EXAMS.filter(e => e.id === selectedExam).map(exam => (
                  <div key={exam.id} className="space-y-5">
                    <div className="border-b border-white/8 pb-4 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                      <div>
                        <h3 className="text-lg font-black text-white">{exam.title}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{exam.description}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <span className="text-[10px] bg-white/5 border border-white/10 text-slate-300 font-bold px-3 py-1.5 rounded-xl">
                          Posts: {exam.totalPosts}
                        </span>
                        <span className="text-[10px] bg-white/5 border border-white/10 text-slate-300 font-bold px-3 py-1.5 rounded-xl">
                          {exam.eligibility}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {/* Syllabus */}
                      <div className="bg-white/5 border border-white/8 p-4 rounded-xl space-y-3">
                        <h4 className="text-xs font-black text-indigo-400 uppercase tracking-wider">Exam Syllabus</h4>
                        <ul className="space-y-1.5">
                          {exam.syllabus.map((syl, i) => (
                            <li key={i} className="text-[11px] text-slate-400 flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                              {syl}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Study Materials */}
                      <div className="md:col-span-2 space-y-3">
                        <h4 className="text-xs font-black text-indigo-400 uppercase tracking-wider">Study Resources</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {exam.studyMaterials.map(mat => (
                            <div
                              key={mat.id}
                              onClick={() => { if (!isPremium) { openSubscribe('signup'); } }}
                              className={`flex gap-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                                isPremium
                                  ? 'bg-white/5 border-white/8 hover:border-indigo-500/40 hover:bg-indigo-500/5'
                                  : 'bg-white/3 border-white/5 opacity-70 hover:opacity-100'
                              }`}
                            >
                              <div className={`p-2 rounded-lg shrink-0 ${isPremium ? (mat.type === 'video' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-rose-500/10 text-rose-400') : 'bg-white/5 text-slate-500'}`}>
                                {isPremium
                                  ? (mat.type === 'video' ? <PlayCircle className="w-5 h-5" /> : <FileText className="w-5 h-5" />)
                                  : <Lock className="w-5 h-5" />}
                              </div>
                              <div className="min-w-0">
                                <h5 className="font-bold text-slate-200 text-xs truncate">{mat.title}</h5>
                                <p className="text-[10px] text-slate-500 mt-0.5">{mat.subject} • {mat.type.toUpperCase()}</p>
                                {!isPremium && (
                                  <p className="inline-flex items-center gap-1 text-[9px] text-amber-400 font-bold mt-1">
                                    <Lock className="w-2.5 h-2.5 inline" /> Subscribe to unlock
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB: PRACTICE TESTS
            ════════════════════════════════════════════════════════════════ */}
        {activeTab === 'practice' && (
          <div className="space-y-6 animate-fade-in">
            {!activeTest ? (
              <>
                <div className="text-center">
                  <h2 className="text-2xl font-black text-white">Practice Mock Assessments</h2>
                  <p className="text-sm text-slate-400 mt-1">Simulate timed exam structures with detailed topic-wise analytics</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
                  {PRACTICE_TESTS.map(test => (
                    <div key={test.id} className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl flex flex-col justify-between hover:border-white/20 transition-all group">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                            {test.category}
                          </span>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase font-mono ${
                            test.difficulty === 'Hard'   ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                            test.difficulty === 'Medium' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            {test.difficulty}
                          </span>
                        </div>
                        <h3 className="font-black text-sm text-white group-hover:text-indigo-300 transition-colors">{test.title}</h3>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {test.durationMinutes} min • {test.totalMarks} marks • {test.questions?.length || 0} questions
                        </p>
                      </div>

                      <button
                        onClick={() => startTest(test.id)}
                        className={`w-full font-black py-3 rounded-xl shadow-md transition-all mt-5 flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer ${
                          isPremium
                            ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 hover:shadow-indigo-500/40'
                            : 'bg-amber-400/90 hover:bg-amber-400 text-slate-900'
                        }`}
                      >
                        {isPremium ? 'Start Mock Test' : <><Lock className="w-4 h-4" /> Subscribe &amp; Unlock</>}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* ── Active Test ── */
              <div className="max-w-3xl mx-auto animate-fade-in">
                {testSubmitted ? (
                  /* Results */
                  <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-2xl text-center space-y-6 animate-scaleUp">
                    <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-3xl flex items-center justify-center mx-auto">
                      <Trophy className="w-10 h-10 text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white">Assessment Complete!</h3>
                      <p className="text-xs text-slate-400 mt-1">{activeTest.title}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-indigo-500/10 border border-indigo-500/20 p-5 rounded-2xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score</p>
                        <p className="text-3xl font-black text-indigo-400 mt-1">
                          {calculateScore()} <span className="text-sm text-indigo-500">/ {activeTest.questions.length}</span>
                        </p>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-2xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Accuracy</p>
                        <p className="text-3xl font-black text-emerald-400 mt-1">
                          {Math.round((calculateScore() / activeTest.questions.length) * 100)}%
                        </p>
                      </div>
                    </div>

                    {/* Topic breakdown */}
                    <div className="bg-white/5 border border-white/8 p-5 rounded-xl text-left space-y-3">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Topic-wise Performance</h4>
                      <div className="space-y-2.5">
                        {Object.entries(
                          activeTest.questions.reduce((acc: any, q: any, idx: number) => {
                            if (!acc[q.topic]) acc[q.topic] = { correct: 0, total: 0 };
                            acc[q.topic].total++;
                            if (selectedAnswers[idx] === q.correctIndex) acc[q.topic].correct++;
                            return acc;
                          }, {} as Record<string, { correct: number; total: number }>)
                        ).map(([topic, stats]: any) => {
                          const pct = Math.round((stats.correct / stats.total) * 100);
                          return (
                            <div key={topic}>
                              <div className="flex justify-between items-center text-xs mb-1">
                                <span className="text-slate-400">{topic}</span>
                                <span className={`font-bold ${pct === 100 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-rose-400'}`}>
                                  {stats.correct}/{stats.total}
                                </span>
                              </div>
                              <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                     style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <button onClick={() => setActiveTest(null)} className={g.btnGhost}>
                      ← Back to Assessments
                    </button>
                  </div>
                ) : (
                  /* Question View */
                  <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 sm:p-8 rounded-2xl space-y-6">
                    {/* Header */}
                    <div className="flex justify-between items-center border-b border-white/8 pb-4">
                      <span className="text-xs font-black text-slate-300 truncate mr-2">{activeTest.title}</span>
                      <span className="bg-white/5 border border-white/10 text-indigo-400 px-3 py-1 rounded-xl font-mono text-xs font-bold shrink-0">
                        Q {currentQuestionIndex + 1} / {activeTest.questions.length}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                           style={{ width: `${((currentQuestionIndex + 1) / activeTest.questions.length) * 100}%` }} />
                    </div>

                    {/* Question */}
                    <div className="space-y-4">
                      <h4 className="text-sm sm:text-base font-bold text-slate-100 leading-relaxed">
                        {activeTest.questions[currentQuestionIndex].question}
                      </h4>
                      <div className="space-y-2.5">
                        {activeTest.questions[currentQuestionIndex].options.map((opt: string, idx: number) => {
                          const selected = selectedAnswers[currentQuestionIndex] === idx;
                          return (
                            <button
                              key={idx}
                              onClick={() => handleAnswerSelect(idx)}
                              className={`w-full text-left p-3.5 rounded-xl border-2 text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
                                selected
                                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                                  : 'border-white/8 bg-white/3 text-slate-400 hover:border-white/20 hover:text-slate-200'
                              }`}
                            >
                              <span>{String.fromCharCode(65 + idx)}.&nbsp;&nbsp;{opt}</span>
                              {selected && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Navigation */}
                    <div className="pt-4 border-t border-white/8 flex justify-between items-center">
                      <button
                        disabled={currentQuestionIndex === 0}
                        onClick={() => setCurrentQuestionIndex(prev => prev - 1)}
                        className="px-4 py-2 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-white/8 disabled:opacity-30 cursor-pointer transition-all"
                      >
                        ← Previous
                      </button>

                      {/* Question dots */}
                      <div className="hidden sm:flex gap-1.5">
                        {activeTest.questions.map((_: any, idx: number) => (
                          <button
                            key={idx}
                            onClick={() => setCurrentQuestionIndex(idx)}
                            className={`w-2.5 h-2.5 rounded-full transition-all cursor-pointer ${
                              idx === currentQuestionIndex ? 'bg-indigo-400 scale-125' :
                              selectedAnswers[idx] !== undefined ? 'bg-emerald-500' : 'bg-white/15'
                            }`}
                          />
                        ))}
                      </div>

                      {currentQuestionIndex === activeTest.questions.length - 1 ? (
                        <button
                          onClick={() => setTestSubmitted(true)}
                          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-500/20 cursor-pointer transition-all"
                        >
                          Submit Exam ✓
                        </button>
                      ) : (
                        <button
                          onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-500/20 cursor-pointer transition-all"
                        >
                          Next →
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
