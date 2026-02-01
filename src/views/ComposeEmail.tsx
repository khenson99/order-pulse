import { useState, useEffect } from 'react';
import { Icons } from '../components/Icons';
import { sendGmailEmail } from '../services/gmailService';
import { improveEmailDraft } from '../services/geminiService';

interface ComposeEmailProps {
  gmailToken: string;
  isMockConnected: boolean;
  prefill?: { to: string, subject: string, body: string } | null;
  onClearDraft?: () => void;
  apiKey?: string; // Passed from parent for Gemini polish
}

export const ComposeEmail: React.FC<ComposeEmailProps> = ({ 
  gmailToken, 
  isMockConnected, 
  prefill, 
  onClearDraft,
  apiKey 
}) => {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  // Handle pre-fill data from reorder buttons
  useEffect(() => {
    if (prefill) {
      setTo(prefill.to);
      setSubject(prefill.subject);
      setBody(prefill.body);
    }
  }, [prefill]);

  const handleImproveDraft = async () => {
    if (!body || !apiKey) {
      if (!apiKey) alert("Please configure your Gemini API Key in the Ingestion Engine first.");
      return;
    }
    
    setIsImproving(true);
    try {
      const polished = await improveEmailDraft(body, apiKey);
      setBody(polished);
    } catch (e) {
      console.error(e);
    } finally {
      setIsImproving(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to || !subject || !body) {
      setStatus({ type: 'error', message: 'Please fill in the To, Subject, and Body fields.' });
      return;
    }

    if (!gmailToken && !isMockConnected) {
      setStatus({ type: 'error', message: 'Please connect to Gmail or Demo mode first.' });
      return;
    }

    setIsSending(true);
    setStatus({ type: null, message: '' });

    if (isMockConnected) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      setStatus({ type: 'success', message: 'Simulation: Email sent successfully!' });
      resetForm();
    } else {
      const success = await sendGmailEmail(gmailToken, to, subject, body, cc, bcc);
      if (success) {
        setStatus({ type: 'success', message: 'Email sent successfully!' });
        resetForm();
      } else {
        setStatus({ type: 'error', message: 'Failed to send email. Check your connection.' });
      }
    }
    setIsSending(false);
  };

  const resetForm = () => {
    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    setBody('');
    if (onClearDraft) onClearDraft();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-arda-text-primary">Compose Message</h2>
          <p className="text-arda-text-muted text-sm">Send reorder requests or supplier inquiries directly.</p>
        </div>
        <div className="flex items-center gap-3">
          {prefill && (
            <div className="bg-arda-accent/10 border border-arda-accent/30 text-arda-accent px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-widest">
              Draft from Intelligence
            </div>
          )}
          {apiKey && (
            <button
              onClick={handleImproveDraft}
              disabled={isImproving || !body}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                isImproving 
                  ? 'bg-arda-bg-tertiary border-arda-border text-arda-text-muted' 
                  : 'bg-arda-accent/10 border-arda-accent/30 text-arda-accent hover:bg-arda-accent hover:text-white'
              }`}
            >
              {isImproving ? <Icons.Loader2 className="w-3 h-3 animate-spin" /> : '✨'}
              {isImproving ? 'Improving...' : 'Improve with AI'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-arda-border rounded-xl overflow-hidden shadow-arda transition-all duration-300">
        <form onSubmit={handleSend} className="divide-y divide-arda-border">
          {/* Recipient */}
          <div className="p-4 flex items-center gap-4 bg-arda-bg-secondary">
            <label className="text-arda-text-muted font-medium w-16 text-sm">To:</label>
            <div className="flex-1 relative flex items-center">
              <Icons.Mail className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-arda-text-muted" />
              <input 
                type="text" 
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="supplier@example.com"
                className="w-full bg-transparent border-none text-arda-text-primary focus:ring-0 pl-7 py-1 text-sm placeholder:text-arda-text-muted"
                disabled={isSending}
              />
              <button 
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-arda-accent hover:underline px-2"
              >
                {showAdvanced ? 'Hide CC/BCC' : 'Cc/Bcc'}
              </button>
            </div>
          </div>

          {/* CC & BCC (Optional) */}
          {showAdvanced && (
            <div className="bg-arda-bg-tertiary animate-in slide-in-from-top-2 duration-200">
              <div className="p-4 flex items-center gap-4 border-b border-arda-border/50">
                <label className="text-arda-text-muted font-medium w-16 text-sm">Cc:</label>
                <div className="flex-1 relative">
                  <input 
                    type="text" 
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="accounts@yourbusiness.com"
                    className="w-full bg-transparent border-none text-arda-text-primary focus:ring-0 py-1 text-sm placeholder:text-arda-text-muted"
                    disabled={isSending}
                  />
                </div>
              </div>
              <div className="p-4 flex items-center gap-4">
                <label className="text-arda-text-muted font-medium w-16 text-sm">Bcc:</label>
                <div className="flex-1 relative">
                  <input 
                    type="text" 
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="archive@yourbusiness.com"
                    className="w-full bg-transparent border-none text-arda-text-primary focus:ring-0 py-1 text-sm placeholder:text-arda-text-muted"
                    disabled={isSending}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="p-4 flex items-center gap-4">
            <label className="text-arda-text-muted font-medium w-16 text-sm">Subject:</label>
            <input 
              type="text" 
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Order Inquiry / Restock Request"
              className="flex-1 bg-transparent border-none text-arda-text-primary focus:ring-0 py-1 text-sm placeholder:text-arda-text-muted font-medium"
              disabled={isSending}
            />
          </div>

          {/* Body */}
          <div className="p-4 bg-arda-bg-tertiary relative">
            <textarea 
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message here... Or type a quick note and use 'Improve with AI'"
              className="w-full bg-transparent border-none text-arda-text-primary focus:ring-0 text-sm placeholder:text-arda-text-muted resize-none leading-relaxed min-h-[300px]"
              disabled={isSending || isImproving}
            />
            {isImproving && (
              <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center animate-pulse">
                <div className="text-arda-accent text-xs font-mono">Polishing draft...</div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-arda-bg-secondary flex items-center justify-between">
            <div className="flex items-center gap-2">
              {status.type === 'success' && (
                <span className="text-arda-success text-xs flex items-center gap-1 animate-in fade-in slide-in-from-left-2">
                  <Icons.CheckCircle2 className="w-3 h-3" /> {status.message}
                </span>
              )}
              {status.type === 'error' && (
                <span className="text-arda-danger text-xs flex items-center gap-1 animate-in fade-in slide-in-from-left-2">
                  <Icons.AlertCircle className="w-3 h-3" /> {status.message}
                </span>
              )}
            </div>
            
            <div className="flex gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="text-arda-text-muted hover:text-arda-text-primary text-xs px-4"
                disabled={isSending}
              >
                Clear
              </button>
              <button
                type="submit"
                disabled={isSending || isImproving}
                className="bg-arda-accent text-white px-6 py-2 rounded-md font-bold text-sm hover:bg-blue-600 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-blue-500/20"
              >
                {isSending ? (
                  <>
                    <Icons.Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Icons.Send className="w-4 h-4" />
                    Send Email
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
