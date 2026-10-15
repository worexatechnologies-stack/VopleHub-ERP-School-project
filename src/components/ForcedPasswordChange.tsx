import { FormEvent, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { useChangePasswordMutation } from '../store/api/authApi';
import { getErrorMessage } from '../utils/apiError';

interface ForcedPasswordChangeProps {
  email: string;
  onComplete: () => void;
  onLogout: () => void;
}

export default function ForcedPasswordChange({ email, onComplete, onLogout }: ForcedPasswordChangeProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [changePasswordMutation] = useChangePasswordMutation();

  const generateStrongPassword = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    const generated = Array.from(crypto.getRandomValues(new Uint32Array(18)), value => alphabet[value % alphabet.length]).join('');
    setPassword(generated);
    setConfirmation(generated);
    setShowPassword(true);
    setShowConfirmation(true);
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await changePasswordMutation({ password }).unwrap();
      onComplete();
    } catch (requestError) {
      const message = getErrorMessage(requestError, 'Could not change your password.');
      setError(message.includes('too similar') ? 'Choose a password that does not contain your name, email, or school name. Use the Generate strong password button below.' : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-700 bg-white p-7 shadow-2xl">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white"><KeyRound className="h-6 w-6" /></div>
        <h1 className="text-xl font-extrabold text-slate-900">Set a new password</h1>
        <p className="mt-2 text-sm text-slate-600">Choose and confirm the password you want to use for this account.</p>
        <p className="mt-2 break-all text-xs font-semibold text-indigo-700">{email}</p>
        {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">New password</label>
        <div className="relative mt-1">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-10 text-sm" placeholder="Enter your chosen password" />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700" aria-label={showPassword ? 'Hide new password' : 'Show new password'}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button type="button" onClick={generateStrongPassword} className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-800">Generate strong password</button>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Confirm new password</label>
        <div className="relative mt-1">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input required type={showConfirmation ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-10 text-sm" placeholder="Repeat the new password" />
          <button type="button" onClick={() => setShowConfirmation((visible) => !visible)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700" aria-label={showConfirmation ? 'Hide confirmation password' : 'Show confirmation password'}>
            {showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button disabled={saving} className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Updating password…' : 'Set password and continue'}</button>
        <button type="button" onClick={onLogout} className="mt-3 w-full text-xs font-semibold text-slate-500 hover:text-slate-700">Sign out</button>
      </form>
    </main>
  );
}
