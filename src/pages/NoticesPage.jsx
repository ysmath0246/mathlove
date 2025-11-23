// src/pages/NoticesPage.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";

// HTML 태그 제거
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// 길이 제한
function truncateText(text = "", max = 80) {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function NoticesPage() {
  const [notices, setNotices] = useState([]);

  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
  const [selectedNotice, setSelectedNotice] = useState(null);

  // 상세보기 모달용
  const [viewNotice, setViewNotice] = useState(null);

  // 실시간 구독
  useEffect(() => {
    const ref = collection(db, "notices");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));

      // 날짜 내림차순 정렬 (YYYY-MM-DD 형태라고 가정)
      list.sort((a, b) => {
        const da = a.date || "";
        const dbb = b.date || "";
        return dbb.localeCompare(da);
      });

      setNotices(list);
    });
  }, []);

  const handleAddNotice = async () => {
    if (!noticeTitle.trim() || !noticeDate.trim()) {
      alert("제목과 날짜를 입력해 주세요.");
      return;
    }
    try {
      await addDoc(collection(db, "notices"), {
        title: noticeTitle,
        date: noticeDate,
        content: noticeContent,
        createdAt: new Date().toISOString(),
      });
      setNoticeTitle("");
      setNoticeDate("");
      setNoticeContent("");
      setSelectedNotice(null);
      alert("공지사항이 추가되었습니다!");
    } catch (e) {
      console.error("공지사항 추가 오류:", e);
      alert("추가 중 오류가 발생했습니다.");
    }
  };

  const handleUpdateNotice = async () => {
    if (!selectedNotice) return;
    if (!noticeTitle.trim() || !noticeDate.trim()) {
      alert("제목과 날짜를 입력해 주세요.");
      return;
    }
    try {
      await updateDoc(doc(db, "notices", selectedNotice.id), {
        title: noticeTitle,
        date: noticeDate,
        content: noticeContent,
        updatedAt: new Date().toISOString(),
      });
      alert("공지사항이 수정되었습니다!");
      setNoticeTitle("");
      setNoticeDate("");
      setNoticeContent("");
      setSelectedNotice(null);
    } catch (e) {
      console.error("공지사항 수정 오류:", e);
      alert("수정 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteNotice = async (id) => {
    if (!window.confirm("이 공지사항을 삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, "notices", id));
    alert("공지사항이 삭제되었습니다.");
  };

  const handleEditNotice = (notice) => {
    setSelectedNotice(notice);
    setNoticeTitle(notice.title || "");
    setNoticeDate(notice.date || "");
    setNoticeContent(notice.content || "");
  };

  const handleOpenView = (notice) => {
    setViewNotice(notice);
  };

  const handleCloseView = () => {
    setViewNotice(null);
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12 }}>
        공지사항 관리
      </h2>

      {/* 입력 영역 */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          background: "#ffffff",
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>
          {selectedNotice ? "🔧 공지사항 수정" : "📝 공지사항 추가"}
        </h3>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <input
            placeholder="공지사항 제목"
            value={noticeTitle}
            onChange={(e) => setNoticeTitle(e.target.value)}
            style={{
              flex: 1,
              minWidth: 160,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
          <input
            type="date"
            value={noticeDate}
            onChange={(e) => setNoticeDate(e.target.value)}
            style={{
              width: 150,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
        </div>

        <textarea
          placeholder="공지 내용 (그냥 글로 쓰셔도 되고, HTML을 붙여넣어도 됩니다)"
          value={noticeContent}
          onChange={(e) => setNoticeContent(e.target.value)}
          rows={6}
          style={{
            width: "100%",
            padding: 8,
            borderRadius: 4,
            border: "1px solid #d1d5db",
            resize: "vertical",
            marginBottom: 8,
            fontSize: 13,
          }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={selectedNotice ? handleUpdateNotice : handleAddNotice}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              border: "none",
              background: "#2563eb",
              color: "white",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {selectedNotice ? "수정하기" : "공지사항 추가"}
          </button>
          {selectedNotice && (
            <button
              onClick={() => {
                setSelectedNotice(null);
                setNoticeTitle("");
                setNoticeDate("");
                setNoticeContent("");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                background: "white",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              새로 작성
            </button>
          )}
        </div>
      </div>

      {/* 목록 영역 */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          background: "#ffffff",
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>
          공지사항 목록
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>제목</th>
                <th style={thStyle}>날짜</th>
                <th style={{ ...thStyle, width: 300 }}>내용 요약</th>
                <th style={thStyle}>보기</th>
                <th style={thStyle}>수정</th>
                <th style={thStyle}>삭제</th>
              </tr>
            </thead>
            <tbody>
              {notices.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: 8,
                      textAlign: "center",
                      color: "#9ca3af",
                    }}
                  >
                    등록된 공지사항이 없습니다.
                  </td>
                </tr>
              )}
              {notices.map((notice) => {
                const preview = truncateText(stripHtml(notice.content || ""), 80);
                return (
                  <tr key={notice.id}>
                    <td style={tdStyle}>{notice.title}</td>
                    <td style={tdStyle}>{notice.date}</td>
                    <td style={{ ...tdStyle, maxWidth: 300 }}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 12,
                          color: "#4b5563",
                        }}
                      >
                        {preview || "-"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => handleOpenView(notice)}
                        style={smallBtn}
                      >
                        상세보기
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => handleEditNotice(notice)}
                        style={smallBtn}
                      >
                        수정
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => handleDeleteNotice(notice.id)}
                        style={smallDangerBtn}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 상세보기 모달 */}
      {viewNotice && (
        <div
          onClick={handleCloseView}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "90%",
              maxWidth: 640,
              maxHeight: "80vh",
              overflowY: "auto",
              background: "white",
              borderRadius: 8,
              boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
              padding: 16,
              fontSize: 13,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: "bold",
                    marginBottom: 4,
                  }}
                >
                  {viewNotice.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                  }}
                >
                  {viewNotice.date}
                </div>
              </div>
              <button
                onClick={handleCloseView}
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: "1px solid #d1d5db",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                닫기
              </button>
            </div>

            <hr
              style={{
                border: "none",
                borderTop: "1px solid #e5e7eb",
                margin: "8px 0 12px",
              }}
            />

            {/* 여기서 HTML을 실제 HTML로 렌더링 */}
            <div
              style={{ fontSize: 13, color: "#111827", lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{
                __html: viewNotice.content || "",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: 8,
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
};
const tdStyle = {
  padding: 8,
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "top",
};
const smallBtn = {
  padding: "4px 8px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
};
const smallDangerBtn = {
  ...smallBtn,
  border: "1px solid #dc2626",
  color: "#dc2626",
};

export default NoticesPage;
