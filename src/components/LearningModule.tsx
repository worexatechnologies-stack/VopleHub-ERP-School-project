import React, { useState } from 'react';
import { PlayCircle, FileText, CheckCircle2, ChevronRight, Upload, HelpCircle, Trophy, BookOpen } from 'lucide-react';
import { ONLINE_COURSES, QUIZZES } from '../data/mockData';

export default function LearningModule() {
  const [activeTab, setActiveTab] = useState<'lessons' | 'homework' | 'quiz'>('lessons');
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  // Homework Upload state
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);

  // Quiz Engine state
  const [quizIndex, setQuizIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);

  // Homework submissions
  const homeworkList: { id: string; title: string; subject: string; class: string; dueDate: string; status: string }[] = [];

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setUploadedFile(e.dataTransfer.files[0].name);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0].name);
    }
  };

  // Quiz helper
  const currentQuiz = QUIZZES[quizIndex];

  const handleAnswerSubmit = () => {
    if (selectedOption === null) return;
    if (!currentQuiz) return;
    if (selectedOption === currentQuiz.correct) {
      setQuizScore(prev => prev + 1);
    }
    setQuizSubmitted(true);
  };

  const handleNextQuiz = () => {
    setSelectedOption(null);
    setQuizSubmitted(false);
    if (quizIndex < QUIZZES.length - 1) {
      setQuizIndex(prev => prev + 1);
    } else {
      setQuizFinished(true);
    }
  };

  const restartQuiz = () => {
    setQuizIndex(0);
    setSelectedOption(null);
    setQuizScore(0);
    setQuizSubmitted(false);
    setQuizFinished(false);
  };

  return (
    <div className="space-y-6" id="learning-module">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-base font-sans font-semibold text-slate-900">LMS & Online Learning Hub</h2>
          <p className="text-xs text-slate-500">Access recorded lectures, notes, assignments, and quizzes created by your school.</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-lg self-start sm:self-center">
          <button
            onClick={() => setActiveTab('lessons')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${activeTab === 'lessons' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Video Lectures
          </button>
          <button
            onClick={() => setActiveTab('homework')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${activeTab === 'homework' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Homework
          </button>
          <button
            onClick={() => setActiveTab('quiz')}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${activeTab === 'quiz' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Online Quizzes
          </button>
        </div>
      </div>

      {activeTab === 'lessons' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Course Player */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 rounded-lg overflow-hidden aspect-video relative flex flex-col items-center justify-center text-white border border-slate-800">
              {playingVideo ? (
                <video
                  src={playingVideo}
                  controls
                  autoPlay
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center p-6 space-y-3">
                  <PlayCircle className="w-16 h-16 text-indigo-400 mx-auto opacity-80" />
                  <h3 className="font-sans font-semibold text-lg">Recorded Lectures Player</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">Select a course module from the playlist catalog to begin streaming learning materials.</p>
                </div>
              )}
            </div>

            {playingVideo && (
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                <h4 className="font-sans font-bold text-slate-900">Streaming selected lesson</h4>
                <p className="text-xs text-slate-500 mt-1">Lesson details appear after school-created content is selected.</p>
              </div>
            )}
          </div>

          {/* Video Playlist */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm h-[420px] flex flex-col">
            <h3 className="font-sans font-semibold text-slate-800 border-b border-slate-50 pb-3 mb-4">Course Video Playlist</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {ONLINE_COURSES.length === 0 ? (
                <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  No lessons have been uploaded yet.
                </div>
              ) : ONLINE_COURSES.map((course) => (
                <div
                  key={course.id}
                  onClick={() => {
                    if (course.type === 'video') setPlayingVideo(course.url);
                  }}
                  className={`p-3 rounded-lg border flex gap-3 items-start cursor-pointer transition-colors ${
                    course.type !== 'video' ? 'bg-slate-50/50 border-slate-100' : 'bg-white border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/10'
                  }`}
                >
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded mt-0.5">
                    {course.type === 'video' ? <PlayCircle className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 leading-tight">{course.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 font-mono">
                      <span>{course.subject}</span>
                      <span>·</span>
                      <span>{course.duration || 'PDF Note'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'homework' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Homework list table */}
          <div className="lg:col-span-2 bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-sans font-semibold text-slate-800 border-b border-slate-50 pb-3">Active Assignments</h3>
            <div className="divide-y divide-slate-100">
              {homeworkList.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  No assignments have been created yet.
                </div>
              ) : homeworkList.map((hw) => (
                <div key={hw.id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{hw.title}</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Subject: {hw.subject} · Class: {hw.class}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">Due: {hw.dueDate}</p>
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${
                      hw.status === 'Submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {hw.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upload Portal */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="font-sans font-semibold text-slate-800">Assignment Upload Desk</h3>
              <p className="text-[11px] text-slate-500">Drag & drop your solved sheets in PDF or Image format below to trigger automated teacher evaluation routing.</p>

              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-6 text-center space-y-2 transition-all cursor-pointer ${
                  dragActive ? 'border-indigo-500 bg-indigo-50/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Upload className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-700 font-semibold">Drag files here, or browse files</p>
                <p className="text-[10px] text-slate-400">PDF, PNG or JPG max 10MB</p>
                <input
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="homework-file-picker"
                />
                <button
                  onClick={() => document.getElementById('homework-file-picker')?.click()}
                  className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-3 py-1 rounded font-semibold mt-1"
                >
                  Choose File
                </button>
              </div>

              {uploadedFile && (
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-800 font-semibold truncate">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="truncate">{uploadedFile}</span>
                  </div>
                  <button
                    onClick={() => {
                      setUploadedFile(null);
                      alert('Homework submitted successfully to classroom vault!');
                    }}
                    className="bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded hover:bg-emerald-700"
                  >
                    Submit
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'quiz' && (
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm max-w-2xl mx-auto">
          {QUIZZES.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
              No quizzes have been created yet.
            </div>
          ) : quizFinished ? (
            /* QUIZ END CARD */
            <div className="text-center py-8 space-y-4">
              <Trophy className="w-16 h-16 text-amber-500 mx-auto animate-bounce" />
              <h3 className="font-sans font-bold text-xl text-slate-900">Quiz Completed Successfully!</h3>
              <p className="text-sm text-slate-500">Your calculated evaluation grade is ready in live records.</p>
              <div className="bg-indigo-50 max-w-xs mx-auto p-4 rounded-lg border border-indigo-200">
                <p className="text-xs font-semibold text-indigo-600 uppercase">SCORE REPORT</p>
                <p className="text-3xl font-sans font-bold text-slate-900 mt-1">{quizScore} / {QUIZZES.length}</p>
                <p className="text-xs text-slate-500 mt-1">Passing percentage is 60%</p>
              </div>
              <button
                onClick={restartQuiz}
                className="bg-indigo-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                Retake Quiz
              </button>
            </div>
          ) : (
            /* ACTIVE QUIZ QUESTION */
            <div className="space-y-6">
              <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">{currentQuiz.subject} Online Test</span>
                </div>
                <span className="text-xs font-mono text-slate-500">Question {quizIndex + 1} of {QUIZZES.length}</span>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 leading-relaxed">{currentQuiz.question}</h3>
                <div className="space-y-2">
                  {currentQuiz.options.map((option, idx) => (
                    <button
                      key={idx}
                      disabled={quizSubmitted}
                      onClick={() => setSelectedOption(idx)}
                      className={`w-full text-left p-3 rounded-lg border text-xs font-semibold transition-all flex justify-between items-center ${
                        selectedOption === idx
                          ? quizSubmitted
                            ? idx === currentQuiz.correct
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                              : 'bg-rose-50 border-rose-400 text-rose-800'
                            : 'bg-indigo-50 border-indigo-400 text-indigo-800'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span>{option}</span>
                      {quizSubmitted && idx === currentQuiz.correct && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </div>

              {quizSubmitted ? (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-2">
                  <p className="font-bold uppercase tracking-wider text-slate-700 text-[10px]">Explanation Notes:</p>
                  <p className="leading-relaxed">{currentQuiz.explanation}</p>
                  <button
                    onClick={handleNextQuiz}
                    className="mt-2 bg-indigo-600 text-white font-semibold py-1.5 px-3 rounded hover:bg-indigo-700 transition-colors flex items-center gap-1 ml-auto"
                  >
                    <span>{quizIndex < QUIZZES.length - 1 ? 'Next Question' : 'Finish Quiz'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  disabled={selectedOption === null}
                  onClick={handleAnswerSubmit}
                  className="w-full bg-slate-900 text-white font-semibold py-2.5 rounded-lg hover:bg-slate-800 transition-colors text-xs disabled:opacity-50"
                >
                  Submit Answer
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
