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

// ───────────────── 유틸 함수들 ─────────────────

// 목록 미리보기용: HTML 태그 제거하고 한 줄로
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// HTML 태그만 제거하고 줄바꿈은 살려두는 버전
function stripHtmlKeepNewlines(html = "") {
  if (!html) return "";
  let t = html;

  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\r\n/g, "\n");

  t = t
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return t;
}

// 예전 HTML 공지 → 사람이 읽기 좋은 텍스트(줄바꿈)로
function htmlToPlainForEdit(html = "") {
  if (!html) return "";
  let t = html;

  t = t
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n\n");

  t = stripHtmlKeepNewlines(t);
  return t;
}

// textarea(plain text) → HTML(<p>, <br>) 로 변환
function plainToHtml(text = "") {
  if (!text) return "";
  // 특수문자 이스케이프
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 빈 줄(2줄 이상) 기준으로 문단 나누기
  const paragraphs = escaped.split(/\n{2,}/);

  return paragraphs
    .map((p) => {
      const withBr = p.replace(/\n/g, "<br/>");
      return `<p>${withBr}</p>`;
    })
    .join("");
}

// 미리보기 길이 제한
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

  // 학부모앱 메인 노출 여부 + 순서
  const [showInParentMain, setShowInParentMain] = useState(false);
  const [mainOrder, setMainOrder] = useState("");

  // 상세보기 모달
  const [viewNotice, setViewNotice] = useState(null);

  // ─────────── Firestore 실시간 구독 ───────────
  useEffect(() => {
    const ref = collection(db, "notices");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));

      // 메인노출 ↓, 순서(mainOrder) ↑, 날짜 내림차순
      list.sort((a, b) => {
        const pa = a.showInParentMain ? 1 : 0;
        const pb = b.showInParentMain ? 1 : 0;
        if (pa !== pb) return pb - pa;

        const oa = typeof a.mainOrder === "number" ? a.mainOrder : 9999;
        const ob = typeof b.mainOrder === "number" ? b.mainOrder : 9999;
        if (oa !== ob) return oa - ob;

        const da = a.date || "";
        const dbb = b.date || "";
        return dbb.localeCompare(da);
      });

      setNotices(list);
    });
  }, []);

  const resetForm = () => {
    setSelectedNotice(null);
    setNoticeTitle("");
    setNoticeDate("");
    setNoticeContent("");
    setShowInParentMain(false);
    setMainOrder("");
  };

  // ─────────── 추가/수정 공통: 필드 만들기 ───────────
  function buildContentFields() {
    const plain = noticeContent || "";
    const html = plainToHtml(plain);
    const orderValue =
      mainOrder === "" || Number.isNaN(Number(mainOrder))
        ? null
        : Number(mainOrder);

    return {
      title: noticeTitle,
      date: noticeDate,
      contentPlain: plain,
      contentHtml: html,
      // 기존 코드 호환용
      content: plain,
      showInParentMain,
      mainOrder: orderValue,
    };
  }

  const handleAddNotice = async () => {
    if (!noticeTitle.trim() || !noticeDate.trim()) {
      alert("제목과 날짜를 입력해 주세요.");
      return;
    }
    try {
      const fields = buildContentFields();
      await addDoc(collection(db, "notices"), {
        ...fields,
        createdAt: new Date().toISOString(),
      });
      resetForm();
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
      const fields = buildContentFields();
      await updateDoc(doc(db, "notices", selectedNotice.id), {
        ...fields,
        updatedAt: new Date().toISOString(),
      });
      alert("공지사항이 수정되었습니다!");
      resetForm();
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

  // 수정 버튼 눌렀을 때
  const handleEditNotice = (notice) => {
    const rawPlain =
      notice.contentPlain ??
      (notice.contentHtml
        ? htmlToPlainForEdit(notice.contentHtml)
        : notice.content || "");

    setSelectedNotice(notice);
    setNoticeTitle(notice.title || "");
    setNoticeDate(notice.date || "");
    setNoticeContent(rawPlain);
    setShowInParentMain(!!notice.showInParentMain);
    setMainOrder(
      typeof notice.mainOrder === "number" ? String(notice.mainOrder) : ""
    );
  };

  const handleOpenView = (notice) => {
    setViewNotice(notice);
  };

  const handleCloseView = () => {
    setViewNotice(null);
  };

  // ───────────────── 렌더 ─────────────────
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

        {/* 메인 노출 + 순서 */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={showInParentMain}
              onChange={(e) => setShowInParentMain(e.target.checked)}
            />
            <span>학부모 앱 메인에 노출</span>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13, color: "#4b5563" }}>메인 순서</span>
            <input
              type="number"
              min={1}
              placeholder="1,2,3..."
              value={mainOrder}
              onChange={(e) => setMainOrder(e.target.value)}
              style={{
                width: 80,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                fontSize: 13,
              }}
            />
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              * 숫자가 작을수록 위에 표시돼요
            </span>
          </div>
        </div>

        <textarea
          placeholder="공지 내용 (그냥 글로 편하게 입력하세요. 줄바꿈도 그대로 저장됩니다)"
          value={noticeContent}
          onChange={(e) => setNoticeContent(e.target.value)}
          rows={10}
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
              onClick={resetForm}
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
                <th style={{ ...thStyle, width: 90 }}>메인노출</th>
                <th style={{ ...thStyle, width: 80 }}>순서</th>
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
                    colSpan={8}
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
                const preview = truncateText(
                  notice.contentPlain ||
                    stripHtml(notice.contentHtml || notice.content || ""),
                  80
                );
                const isMain = !!notice.showInParentMain;
                const order =
                  typeof notice.mainOrder === "number"
                    ? notice.mainOrder
                    : "-";

                return (
                  <tr key={notice.id}>
                    <td style={tdStyle}>{notice.title}</td>
                    <td style={tdStyle}>{notice.date}</td>
                    <td style={tdStyle}>
                      {isMain ? (
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "#dbeafe",
                            color: "#1d4ed8",
                            fontSize: 11,
                          }}
                        >
                          메인 노출
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 11,
                            color: "#9ca3af",
                          }}
                        >
                          -
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12 }}>{order}</span>
                    </td>
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

            {/* 내용 표시: contentHtml 우선, 없으면 plain */}
            {viewNotice.contentHtml ? (
              <div
                style={{ fontSize: 13, color: "#111827", lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{
                  __html: viewNotice.contentHtml,
                }}
              />
            ) : (
              <pre
                style={{
                  fontSize: 13,
                  color: "#111827",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {viewNotice.contentPlain || viewNotice.content || ""}
              </pre>
            )}
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
