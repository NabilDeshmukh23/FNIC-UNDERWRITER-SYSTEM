import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Mail, Shield, AlertCircle, CheckCircle2, Clock, FileText, ChevronRight, ArrowLeft, Play, Layers } from 'lucide-react';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001/api';

export default function App() {
  const [view, setView] = useState('list');
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchSubmissions();
  }, []);

  const fetchSubmissions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/submissions`);
      setSubmissions(res.data);
    } catch (err) {
      console.error('Error fetching submissions:', err);
    }
  };

  const checkInbox = async () => {
    try {
      setLoading(true);
      await axios.post(`${API_BASE}/check-inbox`);
      await fetchSubmissions();
    } catch (err) {
      console.error('Error checking inbox:', err);
      alert('Failed to check inbox. Verify Gmail OAuth credentials.');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id) => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/submissions/${id}`);
      setDetailData(res.data);
      setSelectedSubmissionId(id);
      setView('detail');
    } catch (err) {
      console.error('Error loading detail:', err);
    } finally {
      setLoading(false);
    }
  };

  const runClassification = async (docId) => {
    setActionLoading(true);
    try {
      await axios.post(`${API_BASE}/documents/${docId}/classify`);
      await loadDetail(selectedSubmissionId);
    } catch (err) {
      alert('Classification failed');
    } finally {
      setActionLoading(false);
    }
  };

  const runExtraction = async (docId) => {
    setActionLoading(true);
    try {
      await axios.post(`${API_BASE}/documents/${docId}/extract-fields`);
      await loadDetail(selectedSubmissionId);
    } catch (err) {
      alert('Field extraction failed');
    } finally {
      setActionLoading(false);
    }
  };

  const checkCompleteness = async () => {
    setActionLoading(true);
    try {
      await axios.post(`${API_BASE}/submissions/${selectedSubmissionId}/check-completeness`);
      await loadDetail(selectedSubmissionId);
    } catch (err) {
      alert('Completeness check failed');
    } finally {
      setActionLoading(false);
    }
  };

  const generateAssessment = async () => {
    setActionLoading(true);
    try {
      await axios.post(`${API_BASE}/submissions/${selectedSubmissionId}/generate-assessment`);
      await loadDetail(selectedSubmissionId);
    } catch (err) {
      alert('Assessment generation failed: Ensure all mandatory docs are present.');
    } finally {
      setActionLoading(false);
    }
  };

 const formatLocalDateTime = (dateString) => {
    if (!dateString) return '';
    let isoString = dateString.replace(' ', 'T');
    if (!isoString.endsWith('Z') && !/[+\-]\d{2}:?\d{2}$/.test(isoString)) {
      isoString += 'Z';
    }
    return new Date(isoString).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'processing':
        return <span className="px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center gap-1.5 w-fit whitespace-nowrap"><Clock size={12}/> Processing</span>;
      case 'incomplete':
        return <span className="px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200/60 flex items-center gap-1.5 w-fit whitespace-nowrap"><AlertCircle size={12}/> Incomplete</span>;
      case 'ready_for_review':
        return <span className="px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-full bg-sky-50 text-sky-700 border border-sky-200/60 flex items-center gap-1.5 w-fit whitespace-nowrap"><CheckCircle2 size={12}/> Ready for Review</span>;
      case 'reviewed':
        return <span className="px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1.5 w-fit whitespace-nowrap"><Shield size={12}/> Rated & Reviewed</span>;
      default:
        return <span className="px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">{status}</span>;
    }
  };

  const formatKeyLabel = (key) => {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());
  };

  const renderExtractedData = (fields) => {
    if (!fields || typeof fields !== 'object') return null;

    return (
      <div className="mt-3.5 space-y-3 bg-slate-50/80 p-3 sm:p-4 rounded-xl border border-slate-200/70 text-xs">
        {Object.entries(fields).map(([key, value]) => {
          if (Array.isArray(value)) {
            return (
              <div key={key} className="space-y-1.5">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px] block">
                  {formatKeyLabel(key)}
                </span>
                <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto shadow-sm">
                  <table className="w-full text-left min-w-[300px]">
                    <tbody className="divide-y divide-slate-100">
                      {value.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {typeof item === 'object' && item !== null ? (
                            Object.entries(item).map(([subKey, subVal], subIdx) => (
                              <td key={subIdx} className="p-2.5">
                                <span className="text-[10px] text-slate-400 block font-medium">{formatKeyLabel(subKey)}</span>
                                <span className="font-semibold text-slate-800">
                                  {typeof subVal === 'number' ? subVal.toLocaleString() : String(subVal)}
                                </span>
                              </td>
                            ))
                          ) : (
                            <td className="p-2.5 font-semibold text-slate-800">{String(item)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          if (typeof value === 'object' && value !== null) {
            return (
              <div key={key} className="space-y-1">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px] block">
                  {formatKeyLabel(key)}
                </span>
                <div className="bg-white p-3 rounded-lg border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(value).map(([subKey, subVal]) => (
                    <div key={subKey}>
                      <span className="text-[10px] text-slate-400 block">{formatKeyLabel(subKey)}</span>
                      <span className="font-semibold text-slate-800">{String(subVal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div key={key} className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-1.5 border-b border-slate-200/60 last:border-none gap-1 sm:gap-0">
              <span className="text-slate-500 font-medium">{formatKeyLabel(key)}:</span>
              <span className="font-bold text-slate-800 text-left sm:text-right">
                {typeof value === 'number' ? value.toLocaleString() : String(value)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100/50 to-indigo-50/30 text-slate-900 font-sans antialiased">
      <header className="bg-slate-900 text-white px-4 sm:px-8 py-4 sm:py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-xl border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20 shrink-0">
            <Shield className="text-white" size={22} />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white leading-snug">FNIC Fire Insurance Underwriting Assistant</h1>
          </div>
        </div>
        {view === 'detail' && (
          <button 
            onClick={() => setView('list')}
            className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-700/60 transition shadow-sm w-full sm:w-auto justify-center"
          >
            <ArrowLeft size={15} /> Back to Submissions
          </button>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        {view === 'list' ? (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-200/80">
              <div>
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">Quote Submissions Inbox</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Monitor incoming broker quote requests and automated document attachments.</p>
              </div>
              <button
                onClick={checkInbox}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] w-full sm:w-auto shrink-0"
              >
                <Mail size={16} /> {loading ? 'Polling Gmail...' : 'Check Gmail Inbox'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[650px]">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3.5 px-4 sm:px-6">Broker Name</th>
                      <th className="py-3.5 px-4 sm:px-6">Broker Email</th>
                      <th className="py-3.5 px-4 sm:px-6">Received Date</th>
                      <th className="py-3.5 px-4 sm:px-6">Status</th>
                      <th className="py-3.5 px-4 sm:px-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm font-medium">
                    {submissions.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="py-16 text-center text-slate-400">
                          <div className="max-w-xs mx-auto space-y-2 px-4">
                            <Layers className="mx-auto text-slate-300" size={36} />
                            <p className="text-sm font-semibold text-slate-600">No submissions found</p>
                            <p className="text-xs text-slate-400">Click "Check Gmail Inbox" above to poll new quote emails.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      submissions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-4 px-4 sm:px-6 text-slate-900 font-semibold">{sub.broker_name}</td>
                          <td className="py-4 px-4 sm:px-6 text-slate-600 font-normal">{sub.broker_email}</td>
                          <td className="py-4 px-4 sm:px-6 text-slate-500 font-normal whitespace-nowrap">{formatLocalDateTime(sub.received_at)}</td>
                          <td className="py-4 px-4 sm:px-6">{getStatusBadge(sub.status)}</td>
                          <td className="py-4 px-4 sm:px-6 text-right">
                            <button
                              onClick={() => loadDetail(sub.id)}
                              className="bg-slate-100 hover:bg-blue-50 text-blue-600 font-semibold px-3 py-1.5 rounded-lg text-xs transition inline-flex items-center gap-1 shadow-sm border border-slate-200/50 whitespace-nowrap"
                            >
                              Review <ChevronRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {detailData && (
              <>
                <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-1.5">
                      <h2 className="text-lg sm:text-xl font-bold text-slate-900">{detailData.submission.broker_name}</h2>
                      {getStatusBadge(detailData.submission.status)}
                    </div>
                    <p className="text-xs text-slate-500 font-medium">Email: <span className="text-slate-700 break-all">{detailData.submission.broker_email}</span></p>
                    <p className="text-[11px] text-slate-400 mt-1">Received: {formatLocalDateTime(detailData.submission.received_at)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                    <button
                      onClick={checkCompleteness}
                      disabled={actionLoading}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-sm transition active:scale-[0.98] disabled:opacity-50 flex-1 sm:flex-none text-center"
                    >
                      Check Completeness
                    </button>
                    {detailData.submission.status === 'ready_for_review' && (
                      <button
                        onClick={generateAssessment}
                        disabled={actionLoading}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-md shadow-emerald-600/20 transition active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none text-center"
                      >
                        <Play size={14} /> Run RAG Assessment & Quote
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="w-full lg:w-1/3 space-y-4 order-1 lg:order-2">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider px-1">Underwriting Assessment</h3>
                    {detailData.assessment ? (
                      <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-200/80 space-y-5">
                        <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 border border-emerald-200/80 p-4 sm:p-5 rounded-2xl shadow-sm">
                          <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">Indicative Annual Premium</span>
                          <div className="text-xl sm:text-2xl font-black text-emerald-950 mt-1">{detailData.assessment.indicative_premium}</div>
                        </div>

                        <div className="space-y-2.5 text-xs font-medium">
                          <div className="flex justify-between py-1.5 border-b border-slate-100">
                            <span className="text-slate-500">Base Rate:</span>
                            <span className="font-bold text-slate-800">{detailData.assessment.base_rate}</span>
                          </div>
                          <div className="flex justify-between py-1.5 border-b border-slate-100">
                            <span className="text-slate-500">Final Rate per Mille:</span>
                            <span className="font-bold text-slate-800">{detailData.assessment.final_rate_per_mille}</span>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Adjustments Applied</h4>
                          <ul className="space-y-1.5">
                            {detailData.assessment.adjustments_applied?.map((adj, idx) => (
                              <li key={idx} className="text-xs bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 text-slate-700 font-medium flex items-start gap-2">
                                <span className="text-blue-500 font-bold shrink-0">•</span> <span>{adj}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Risk Summary</h4>
                          <p className="text-xs text-slate-600 bg-slate-50/80 p-3.5 rounded-xl border border-slate-100 leading-relaxed">{detailData.assessment.risk_summary}</p>
                        </div>

                        <div>
                          <h4 className="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-1.5">Flagged Concerns</h4>
                          <p className="text-xs text-amber-900 bg-amber-50/80 p-3.5 rounded-xl border border-amber-200/60 leading-relaxed">{detailData.assessment.flagged_concerns}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200/80 text-center space-y-3">
                        <div className="p-3 bg-slate-100 text-slate-400 w-fit mx-auto rounded-2xl">
                          <Shield size={32} />
                        </div>
                        <p className="text-sm font-semibold text-slate-700">No risk assessment generated yet</p>
                        <p className="text-xs text-slate-400 leading-relaxed">Ensure all mandatory documents are uploaded and verified, then run RAG Assessment.</p>
                      </div>
                    )}
                  </div>

                  <div className="w-full lg:w-2/3 space-y-4 order-2 lg:order-1">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider px-1">Attached Documents</h3>
                    {detailData.documents.map((doc) => (
                      <div key={doc.id} className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200/80 space-y-3.5 transition hover:border-slate-300">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                              <FileText size={18} />
                            </div>
                            <span className="font-semibold text-slate-800 text-xs sm:text-sm truncate">{doc.original_filename}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] sm:text-[11px] px-2.5 py-1 bg-slate-100 rounded-lg text-slate-700 font-bold uppercase tracking-wide">
                              {doc.document_type}
                            </span>
                            <span className={`text-[10px] sm:text-[11px] px-2.5 py-1 rounded-lg font-semibold ${doc.classification_confidence === 'high' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-amber-50 text-amber-700 border border-amber-200/50'}`}>
                              {doc.classification_confidence} confidence
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
                          <button
                            onClick={() => runClassification(doc.id)}
                            disabled={actionLoading}
                            className="bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 transition"
                          >
                            Re-classify
                          </button>
                          <button
                            onClick={() => runExtraction(doc.id)}
                            disabled={actionLoading}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-200/50 transition"
                          >
                            Extract Fields
                          </button>
                        </div>

                        {doc.extracted_fields && renderExtractedData(doc.extracted_fields)}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}