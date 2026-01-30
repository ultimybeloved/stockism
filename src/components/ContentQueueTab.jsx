import React, { useState, useEffect } from 'react';
import { listPendingContentFunction, approveContentFunction, rejectContentFunction } from '../firebase';

const ContentQueueTab = ({ darkMode }) => {
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedContent, setSelectedContent] = useState(null);

  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200';

  useEffect(() => {
    loadContent();
  }, []);

  const loadContent = async () => {
    try {
      setLoading(true);
      const result = await listPendingContentFunction();
      setContent(result.data.content || []);
    } catch (error) {
      console.error('Error loading content:', error);
      setMessage({ type: 'error', text: 'Failed to load content queue' });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (contentId) => {
    try {
      setMessage(null);
      await approveContentFunction({ contentId });
      setMessage({ type: 'success', text: 'Content approved!' });
      await loadContent(); // Reload
    } catch (error) {
      console.error('Error approving content:', error);
      setMessage({ type: 'error', text: 'Failed to approve content' });
    }
  };

  const handleReject = async (contentId) => {
    try {
      setMessage(null);
      await rejectContentFunction({ contentId });
      setMessage({ type: 'success', text: 'Content rejected' });
      await loadContent(); // Reload
    } catch (error) {
      console.error('Error rejecting content:', error);
      setMessage({ type: 'error', text: 'Failed to reject content' });
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  const getTypeEmoji = (type) => {
    switch (type) {
      case 'character-spotlight':
        return '⭐';
      case 'market-movers':
        return '📊';
      case 'drama-event':
        return '🔥';
      default:
        return '🎬';
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'character-spotlight':
        return 'Character Spotlight';
      case 'market-movers':
        return 'Market Movers';
      case 'drama-event':
        return 'Drama Event';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`p-4 rounded ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
        <h3 className="font-bold text-lg mb-2">Content Queue</h3>
        <p className={`text-sm ${mutedClass}`}>
          Review auto-generated videos before publishing to YouTube Shorts
        </p>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded ${message.type === 'success' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
          {message.text}
        </div>
      )}

      {/* Content List */}
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className={`mt-2 ${mutedClass}`}>Loading content...</p>
        </div>
      ) : content.length === 0 ? (
        <div className={`p-8 text-center ${cardClass} border rounded`}>
          <p className={mutedClass}>No pending content to review</p>
          <p className={`text-xs ${mutedClass} mt-2`}>Videos will appear here when auto-generated from market events</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {content.map((item) => (
            <div key={item.id} className={`${cardClass} border rounded p-4`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{getTypeEmoji(item.type)}</span>
                    <h4 className="font-bold">{getTypeLabel(item.type)}</h4>
                  </div>
                  <p className={`text-xs ${mutedClass}`}>
                    Generated: {formatDate(item.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(item.id)}
                    className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-semibold transition-colors"
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleReject(item.id)}
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-semibold transition-colors"
                  >
                    ✗ Reject
                  </button>
                </div>
              </div>

              {/* Content Details */}
              <div className={`p-3 rounded text-sm ${darkMode ? 'bg-slate-700/30' : 'bg-slate-50'}`}>
                {item.type === 'character-spotlight' && item.data && (
                  <div className="space-y-1">
                    <p><span className="font-semibold">Character:</span> {item.data.characterName} (${item.data.ticker})</p>
                    <p><span className="font-semibold">Price:</span> ${item.data.price?.toFixed(2)}</p>
                    <p><span className="font-semibold">Change:</span> <span className={item.data.changePercent >= 0 ? 'text-green-500' : 'text-red-500'}>
                      {item.data.changePercent >= 0 ? '+' : ''}{item.data.changePercent?.toFixed(2)}%
                    </span></p>
                    {item.data.volume && <p><span className="font-semibold">Volume:</span> {item.data.volume} trades</p>}
                    <p><span className="font-semibold">Hook:</span> "{item.data.hook}"</p>
                  </div>
                )}

                {item.type === 'market-movers' && item.data && (
                  <div className="space-y-2">
                    <p className="font-semibold">
                      {item.data.type === 'gainers' ? '📈 Top Gainers' : '📉 Top Losers'} - {item.data.timeframe}
                    </p>
                    <div className="space-y-1">
                      {item.data.movers?.map((mover, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>{idx + 1}. {mover.name} (${mover.ticker})</span>
                          <span className={mover.change >= 0 ? 'text-green-500' : 'text-red-500'}>
                            {mover.change >= 0 ? '+' : ''}{mover.change?.toFixed(2)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {item.type === 'drama-event' && item.data && (
                  <div className="space-y-1">
                    <p><span className="font-semibold">Alert:</span> {item.data.alertText}</p>
                    <p><span className="font-semibold">Headline:</span> {item.data.headline}</p>
                    {item.data.stat && <p><span className="font-semibold">Stat:</span> {item.data.stat}</p>}
                  </div>
                )}
              </div>

              {/* Video Preview */}
              {item.videoUrl && (
                <div className="mt-3">
                  <a
                    href={item.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-semibold transition-colors"
                  >
                    🎬 Preview Video
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={loadContent}
        disabled={loading}
        className={`w-full py-2 rounded font-semibold transition-colors ${
          loading
            ? 'bg-slate-500/50 cursor-not-allowed'
            : darkMode
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-slate-200 hover:bg-slate-300'
        }`}
      >
        {loading ? 'Loading...' : '🔄 Refresh Queue'}
      </button>
    </div>
  );
};

export default ContentQueueTab;
