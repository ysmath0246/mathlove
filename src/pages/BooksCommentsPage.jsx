// src/pages/BookCommentsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  addDoc,
} from "firebase/firestore";

const TAB_LABELS = {
  current: "재원생",
  new: "신규생",
  quit: "퇴원생",
};

const PAGE_SIZE = 6; // 학생 목록 6명씩

function StudentsPage() {
  const [tab, setTab] = useState("current");

  const [currentStudents, setCurrentStudents] = useState([]);
  const [newStudents, setNewStudents] = useState([]);
  const [quitStudents, setQuitStudents] = useState([]);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);

  // ✅ answer 기록이 있는 학생 이름 목록
  const [answeredStudentNames, setAnsweredStudentNames] = useState([]);

  // --- 재원생(students) ---
  useEffect(() => {
    const ref = collection(db, "students");
    const qy = query(ref, orderBy("name", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCurrentStudents(list);
    });
  }, []);

  // --- 신규생(newstudent) (탭은 숨겨도 데이터는 구독해 둠) ---
  useEffect(() => {
    const ref = collection(db, "newstudent");
    const qy = query(ref, orderBy("studentName", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNewStudents(list);
    });
  }, []);

  // --- 퇴원생(students_quit) ---
  useEffect(() => {
    const ref = collection(db, "students_quit");
    const qy = query(ref, orderBy("name", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setQuitStudents(list);
    });
  }, []);

  // ✅ answer 컬렉션 전체 구독해서 "답변 있는 학생" 명단 만들기
  useEffect(() => {
    const ref = collection(db, "answer");
    return onSnapshot(ref, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const nameSet = new Set();

      all.forEach((a) => {
        const sname = a.studentName || a.name || "";
        if (sname) nameSet.add(sname);
      });

      setAnsweredStudentNames(Array.from(nameSet));
    });
  }, []);

  // 현재 탭에 맞는 리스트
  const activeList = useMemo(() => {
    if (tab === "current") return currentStudents;
    if (tab === "new") return newStudents;
    if (tab === "quit") return quitStudents;
    return [];
  }, [tab, currentStudents, newStudents, quitStudents]);

  // 검색
  const filteredList = useMemo(() => {
    const kw = search.trim();
    if (!kw) return activeList;

    return activeList.filter((s) => {
      const name = (s.name || s.studentName || "").toString();
      const parentPhone =
        (s.parentPhone ||
          s.parentTel ||
          s.parentPhoneNumber ||
          "").toString();
      const studentPhone = (s.studentPhone || s.phone || "").toString();

      return (
        name.includes(kw) ||
        parentPhone.includes(kw) ||
        studentPhone.includes(kw)
      );
    });
  }, [activeList, search]);

  // 페이지네이션
  const totalPages = Math.max(
    1,
    Math.ceil((filteredList.length || 1) / PAGE_SIZE)
  );
  const safePageIndex =
    pageIndex >= totalPages ? totalPages - 1 : pageIndex < 0 ? 0 : pageIndex;

  const pagedList = useMemo(() => {
    const start = safePageIndex * PAGE_SIZE;
    return filteredList.slice(start, start + PAGE_SIZE);
  }, [filteredList, safePageIndex]);

  // 선택된 학생
  const selectedStudent = useMemo(() => {
    if (!selectedId) return null;
    return activeList.find((s) => s.id === selectedId) || null;
  }, [activeList, selectedId]);

  // 탭/검색 바뀌면 초기화
  useEffect(() => {
    setSelectedId(null);
    setSearch("");
    setPageIndex(0);
  }, [tab]);

  useEffect(() => {
    setPageIndex(0);
  }, [search]);

  // --- (이 페이지에서는 승인/퇴원/복귀 버튼은 안 쓰지만, 혹시 다른 곳에서 재사용할 수 있어 남겨 둠) ---
  const handleApproveNewStudent = async (student) => {
    if (
      !window.confirm(
        `${
          student.name || student.studentName || ""
        } 학생을 재원생으로 승인할까요?`
      )
    )
      return;

    try {
      const { id, ...rest } = student;

      const name = student.name || student.studentName || "";
      const birth =
        student.studentBirth ||
        student.birth ||
        student.birthday ||
        student.birthDate ||
        "";
      const parentPhone =
        student.parentPhone ||
        student.parentTel ||
        student.parentPhoneNumber ||
        "";
      const studentPhone = student.studentPhone || student.phone || "";
      const startDate =
        student.startDate ||
        student.classStartDate ||
        student.beginDate ||
        "";

      const days =
        student.days ||
        student.weekdays ||
        student.classDays ||
        student.scheduleDays ||
        student["수업요일"] ||
        [];
      const time =
        student.time ||
        student.classTime ||
        student.times ||
        student.scheduleTime ||
        student["수업시간"] ||
        "";

      await setDoc(doc(db, "students", student.id), {
        ...rest,
        name,
        studentName: name,
        birth,
        studentBirth: birth,
        parentPhone,
        studentPhone,
        startDate,
        days: Array.isArray(days) ? days : days ? [days] : [],
        time,
        status: "재원생",
        approvedAt: serverTimestamp(),
      });

      await deleteDoc(doc(db, "newstudent", student.id));

      alert("재원생으로 승인되었습니다.");
    } catch (e) {
      console.error("신규생 승인 오류:", e);
      alert("승인 중 오류가 발생했습니다.");
    }
  };

  const handleQuitStudent = async () => {
    // 이 페이지에서는 사용하지 않으므로 비워 둠
  };

  const handleRestoreStudent = async () => {
    // 이 페이지에서는 사용하지 않으므로 비워 둠
  };

  return (
    <div style={{ fontSize: 13 }}>
      {/* 헤더 + 탭 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: "bold" }}>북 · 코멘트 관리</h2>
          <div
            style={{
              fontSize: 11,
              color: "#4b5563",
              maxWidth: 520,
              lineHeight: 1.4,
            }}
          >
            <b>부모님 답변이 등록된 학생</b>:{" "}
            {answeredStudentNames.length === 0
              ? "아직 없습니다."
              : answeredStudentNames.join(", ")}
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {["current", "quit"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                background:
                  tab === t ? "#3b82f6" : "rgba(255,255,255,0.9)",
                color: tab === t ? "white" : "#374151",
                fontWeight: "bold",
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 메인 박스 */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 8,
          background: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "stretch",
            minHeight: 320,
          }}
        >
          {/* 왼쪽: 학생 목록 (6명씩) */}
          <div
            style={{
              width: 260,
              borderRight: "1px solid #e5e7eb",
              paddingRight: 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: "bold",
                  marginBottom: 4,
                }}
              >
                {TAB_LABELS[tab]} 목록 ({activeList.length}명)
              </div>
              <input
                type="text"
                placeholder="이름 / 학부모폰 / 학생폰 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "4px 8px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: "1px solid #d1d5db",
                  marginBottom: 4,
                }}
              />

              {/* 페이지 네비게이션 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                  disabled={safePageIndex <= 0}
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #d1d5db",
                    background: safePageIndex <= 0 ? "#f9fafb" : "white",
                    cursor: safePageIndex <= 0 ? "default" : "pointer",
                  }}
                >
                  ◀
                </button>
                <span style={{ color: "#6b7280" }}>
                  {totalPages === 0 ? "0 / 0" : `${safePageIndex + 1} / ${totalPages}`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPageIndex((p) =>
                      Math.min(totalPages - 1, (p || 0) + 1)
                    )
                  }
                  disabled={safePageIndex >= totalPages - 1}
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #d1d5db",
                    background:
                      safePageIndex >= totalPages - 1 ? "#f9fafb" : "white",
                    cursor:
                      safePageIndex >= totalPages - 1 ? "default" : "pointer",
                  }}
                >
                  ▶
                </button>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                borderRadius: 4,
                border: "1px solid #e5e7eb",
              }}
            >
              {pagedList.length === 0 ? (
                <div
                  style={{
                    padding: 8,
                    fontSize: 12,
                    color: "#9ca3af",
                  }}
                >
                  해당 페이지에 학생이 없습니다.
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                  }}
                >
                  {pagedList.map((s) => {
                    const name = s.name || s.studentName || "(이름 없음)";
                    const birth =
                      s.studentBirth ||
                      s.birth ||
                      s.birthday ||
                      s.birthDate ||
                      "";
                    const parentPhone =
                      s.parentPhone ||
                      s.parentTel ||
                      s.parentPhoneNumber ||
                      "";
                    const isSelected = s.id === selectedId;

                    return (
                      <li
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        style={{
                          padding: 8,
                          cursor: "pointer",
                          background: isSelected ? "#eff6ff" : "white",
                          borderBottom: "1px solid #f3f4f6",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: "bold",
                          }}
                        >
                          {name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          {birth || "생년월일 미입력"}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#9ca3af",
                          }}
                        >
                          학부모: {parentPhone || "-"}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* 오른쪽: 상세 정보 + 북/코멘트 */}
          <div style={{ flex: 1, paddingLeft: 4 }}>
            <div
              style={{
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: "1px dashed #e5e7eb",
              }}
            >
              {selectedStudent ? (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: "bold",
                    marginBottom: 2,
                  }}
                >
                  {selectedStudent.name ||
                    selectedStudent.studentName ||
                    "(이름 없음)"}{" "}
                  <span
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
                      marginLeft: 4,
                    }}
                  >
                    [{TAB_LABELS[tab]}]
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: "#9ca3af",
                  }}
                >
                  왼쪽에서 학생을 선택하면 상세 정보가 보입니다.
                </div>
              )}
            </div>

            <StudentDetail
              key={`${selectedId || "none"}_${tab}`}
              tab={tab}
              student={selectedStudent}
              onApprove={handleApproveNewStudent}
              onQuit={handleQuitStudent}
              onRestore={handleRestoreStudent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 상세 정보 + 북/코멘트 탭 */
function StudentDetail({ tab, student, onApprove, onQuit, onRestore }) {
  const [subTab, setSubTab] = useState("books"); // books | comments

  useEffect(() => {
    setSubTab("books");
  }, [student, tab]);

  if (!student) return null;

  const name = student.name || student.studentName || "";
  const birth =
    student.studentBirth ||
    student.birth ||
    student.birthday ||
    student.birthDate ||
    "";

  const parentPhone =
    student.parentPhone ||
    student.parentTel ||
    student.parentPhoneNumber ||
    "";

  const studentPhone = student.studentPhone || student.phone || "";

  const startDate =
    student.startDate ||
    student.classStartDate ||
    student.beginDate ||
    "";

  // ✅ schedules 우선 사용, 없으면 예전 days/time 사용
  const schedulesArr = Array.isArray(student.schedules)
    ? student.schedules
    : [];

  const scheduleFromSchedules = schedulesArr
    .map((s) => {
      const d = s.day || s.dayOfWeek || "";
      const t = s.time || s.startTime || "";
      if (!d && !t) return "";
      return `${d} ${t}`.trim();
    })
    .filter(Boolean)
    .join(", ");

  const days =
    student.days ||
    student.weekdays ||
    student.classDays ||
    student.scheduleDays ||
    student["수업요일"] ||
    [];
  const time =
    student.time ||
    student.classTime ||
    student.times ||
    student.scheduleTime ||
    student["수업시간"] ||
    "";

  const daysText = Array.isArray(days) ? days.join(", ") : days || "";
  const scheduleFallback =
    daysText || time
      ? [daysText, time].filter(Boolean).join(" / ")
      : "";

  const scheduleText = scheduleFromSchedules || scheduleFallback;

  return (
    <div style={{ fontSize: 12 }}>
      {/* 기본 정보 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          rowGap: 6,
          columnGap: 8,
          marginBottom: 12,
        }}
      >
        <div style={labelStyle}>이름</div>
        <div>{name || "-"}</div>

        <div style={labelStyle}>생년월일</div>
        <div>{birth || "-"}</div>

        <div style={labelStyle}>학부모 핸드폰</div>
        <div>{parentPhone || "-"}</div>

        <div style={labelStyle}>학생 핸드폰</div>
        <div>{studentPhone || "-"}</div>

        <div style={labelStyle}>수업 시작일</div>
        <div>{startDate || "-"}</div>

        <div style={labelStyle}>스케줄 (요일/시간)</div>
        <div>{scheduleText || "-"}</div>
      </div>

      {/* 상단 액션: 이 페이지에서는 버튼 숨김 (읽기 전용) */}
      {/* 필요하면 나중에 다시 살릴 수 있게 주석만 남겨둠
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {tab === "new" && (
          <button ...>✅ 재원생으로 승인</button>
        )}
        {tab === "current" && (
          <button ...>퇴원 처리</button>
        )}
        {tab === "quit" && (
          <button ...>🔄 재원생으로 복귀</button>
        )}
      </div>
      */}

      {/* 북 / 코멘트 서브 탭 */}
      <div
        style={{
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            borderRadius: 999,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {[
            { key: "books", label: "📚 북 기록" },
            { key: "comments", label: "💬 코멘트" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              style={{
                padding: "3px 10px",
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                background:
                  subTab === t.key ? "#3b82f6" : "rgba(255,255,255,0.9)",
                color: subTab === t.key ? "white" : "#374151",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 서브 탭 내용 */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          padding: 8,
          background: "#f9fafb",
        }}
      >
        {subTab === "books" && <StudentBooksSection student={student} />}
        {subTab === "comments" && (
          <StudentCommentsSection student={student} />
        )}
      </div>
    </div>
  );
}

/** 북(책/문제집) 기록 + 입력 */
function StudentBooksSection({ student }) {
  const [books, setBooks] = useState([]);

  const [bookDate, setBookDate] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [bookGrade, setBookGrade] = useState("");
  const [bookMemo, setBookMemo] = useState("");

  useEffect(() => {
    if (!student) return;
    const ref = collection(db, "books");

    return onSnapshot(ref, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sid = student.id;
      const sname = student.name || student.studentName || "";

      const filtered = all.filter((b) => {
        const bid =
          b.studentId || b.studentID || b.student_id || b.sid || "";
        const bname = b.studentName || b.name || "";
        if (bid && sid && bid === sid) return true;
        if (sname && bname && sname === bname) return true;
        return false;
      });

      filtered.sort((a, b) => {
        // completedDate, date, dateText, createdAt 순으로 정렬
        const getDateKey = (x) => {
          if (x.completedDate) return x.completedDate;
          if (x.date) return x.date;
          if (x.dateText) return x.dateText;
          if (x.createdAt && x.createdAt.toDate) {
            return x.createdAt.toDate().toISOString().slice(0, 10);
          }
          return "";
        };
        const da = getDateKey(a);
        const db = getDateKey(b);
        return db.localeCompare(da); // 최신 날짜 먼저
      });

      setBooks(filtered);
    });
  }, [student]);

  const handleAddBook = async () => {
    if (!student) return;
    if (!bookTitle.trim()) {
      alert("책/문제집 제목을 입력해 주세요.");
      return;
    }

    try {
      const sname = student.name || student.studentName || "";
      const payload = {
        studentId: student.id,
        studentName: sname,
        bookTitle: bookTitle.trim(),
        title: bookTitle.trim(),
        memo: bookMemo.trim(),
        grade: bookGrade.trim(),
        createdAt: serverTimestamp(),
      };

      if (bookDate) {
        // 기존 데이터 형식과 맞추기 위해 둘 다 저장
        payload.completedDate = bookDate;
        payload.dateText = bookDate;
        payload.date = bookDate;
      }

      await addDoc(collection(db, "books"), payload);

      setBookTitle("");
      setBookMemo("");
      setBookGrade("");
      setBookDate("");
    } catch (e) {
      console.error("북 기록 추가 오류:", e);
      alert("북 기록 추가 중 오류가 발생했습니다.");
    }
  };

  if (!student) return null;

  return (
    <div style={{ fontSize: 12 }}>
      {/* 입력 폼 */}
      <div
        style={{
          marginBottom: 8,
          padding: 6,
          borderRadius: 4,
          background: "#e5e7eb",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: "bold",
            marginBottom: 4,
          }}
        >
          새 북(책/문제집) 기록 추가
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <input
            type="date"
            value={bookDate}
            onChange={(e) => setBookDate(e.target.value)}
            style={{
              padding: "4px 6px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
          <input
            type="text"
            placeholder="책 / 문제집 제목"
            value={bookTitle}
            onChange={(e) => setBookTitle(e.target.value)}
            style={{
              flex: 1,
              minWidth: 140,
              padding: "4px 6px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
          <input
            type="text"
            placeholder="학년 / 반 (예: 초4, 중1-1)"
            value={bookGrade}
            onChange={(e) => setBookGrade(e.target.value)}
            style={{
              width: 120,
              padding: "4px 6px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
        </div>
        <textarea
          placeholder="진도, 난이도, 숙제 등 메모"
          value={bookMemo}
          onChange={(e) => setBookMemo(e.target.value)}
          rows={2}
          style={{
            width: "100%",
            padding: 6,
            fontSize: 11,
            borderRadius: 4,
            border: "1px solid #d1d5db",
            resize: "vertical",
            marginBottom: 4,
          }}
        />
        <button
          type="button"
          onClick={handleAddBook}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: "none",
            background: "#3b82f6",
            color: "white",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ➕ 북 기록 추가
        </button>
      </div>

      {/* 리스트 */}
      {books.length === 0 ? (
        <div style={{ color: "#9ca3af" }}>
          등록된 북(책/문제집) 기록이 없습니다.
        </div>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={subThStyle}>완료 날짜</th>
              <th style={subThStyle}>학년</th>
              <th style={subThStyle}>책 / 문제집</th>
              <th style={subThStyle}>내용 / 메모</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => {
              const title =
                b.bookTitle || b.title || b.name || "(제목 없음)";
              const memo = b.memo || b.note || b.content || "";
              const grade =
                b.grade || b.gradeText || b.schoolYear || b["학년"] || "";
              let dateText = "";
              if (b.completedDate) dateText = b.completedDate;
              else if (b.dateText) dateText = b.dateText;
              else if (b.date) dateText = b.date;
              else if (b.createdAt && b.createdAt.toDate) {
                dateText = b.createdAt.toDate().toISOString().slice(0, 10);
              }

              return (
                <tr key={b.id}>
                  <td style={subTdStyle}>{dateText || "-"}</td>
                  <td style={subTdStyle}>{grade || "-"}</td>
                  <td style={subTdStyle}>{title}</td>
                  <td style={subTdStyle}>{memo || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <details style={{ marginTop: 6 }}>
        <summary
          style={{
            fontSize: 11,
            color: "#6b7280",
            cursor: "pointer",
          }}
        >
          북 raw 데이터 보기
        </summary>
        <pre
          style={{
            fontSize: 11,
            background: "#f3f4f6",
            padding: 6,
            borderRadius: 4,
            marginTop: 4,
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          {JSON.stringify(books, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** 코멘트 + 학부모 answer */
function StudentCommentsSection({ student }) {
  const [comments, setComments] = useState([]);
  const [answers, setAnswers] = useState([]);

  const [commentDate, setCommentDate] = useState("");
  const [commentText, setCommentText] = useState("");

  // 코멘트 불러오기
  useEffect(() => {
    if (!student) return;
    const ref = collection(db, "comments");

    return onSnapshot(ref, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sid = student.id;
      const sname = student.name || student.studentName || "";

      const filtered = all.filter((c) => {
        const cid =
          c.studentId || c.studentID || c.student_id || c.sid || "";
        const cname = c.studentName || c.name || "";
        if (cid && sid && cid === sid) return true;
        if (sname && cname && sname === cname) return true;
        return false;
      });

      filtered.sort((a, b) => {
        const ta =
          (a.createdAt && a.createdAt.seconds) ||
          (a.createdAt && a.createdAt._seconds) ||
          0;
        const tb =
          (b.createdAt && b.createdAt.seconds) ||
          (b.createdAt && b.createdAt._seconds) ||
          0;
        return tb - ta;
      });

      setComments(filtered);
    });
  }, [student]);

  // 학부모 answer 불러오기 (answer 컬렉션)
  useEffect(() => {
    if (!student) return;
    const ref = collection(db, "answer");

    return onSnapshot(ref, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sid = student.id;
      const sname = student.name || student.studentName || "";

      const filtered = all.filter((a) => {
        const aid =
          a.studentId || a.studentID || a.student_id || a.sid || "";
        const aname = a.studentName || a.name || "";
        if (aid && sid && aid === sid) return true;
        if (sname && aname && sname === aname) return true;
        return false;
      });

      filtered.sort((a, b) => {
        const da = a.date || "";
        const db = b.date || "";
        return db.localeCompare(da);
      });

      setAnswers(filtered);
    });
  }, [student]);

  const handleAddComment = async () => {
    if (!student) return;
    if (!commentText.trim()) {
      alert("코멘트 내용을 입력해 주세요.");
      return;
    }

    try {
      const sname = student.name || student.studentName || "";
      const payload = {
        studentId: student.id,
        studentName: sname,
        text: commentText.trim(),
        createdAt: serverTimestamp(),
      };
      if (commentDate) {
        payload.dateText = commentDate;
        payload.date = commentDate;
      }

      await addDoc(collection(db, "comments"), payload);

      setCommentText("");
      setCommentDate("");
    } catch (e) {
      console.error("코멘트 추가 오류:", e);
      alert("코멘트 추가 중 오류가 발생했습니다.");
    }
  };

  const answersByDate = useMemo(() => {
    const map = {};
    answers.forEach((a) => {
      const key = a.date || a.dateText || "";
      const text =
        a.comment || a.answer || a.content || a.text || "";
      if (!key) return;
      if (!map[key]) map[key] = [];
      if (text) map[key].push(text);
    });
    return map;
  }, [answers]);

  if (!student) return null;

  return (
    <div style={{ fontSize: 12 }}>
      {/* 입력 폼 */}
      <div
        style={{
          marginBottom: 8,
          padding: 6,
          borderRadius: 4,
          background: "#e5e7eb",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: "bold",
            marginBottom: 4,
          }}
        >
          새 코멘트 작성
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <input
            type="date"
            value={commentDate}
            onChange={(e) => setCommentDate(e.target.value)}
            style={{
              padding: "4px 6px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
        </div>
        <textarea
          placeholder="수업 내용, 태도, 숙제, 시험 결과 등 코멘트"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          rows={3}
          style={{
            width: "100%",
            padding: 6,
            fontSize: 11,
            borderRadius: 4,
            border: "1px solid #d1d5db",
            resize: "vertical",
            marginBottom: 4,
          }}
        />
        <button
          type="button"
          onClick={handleAddComment}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: "none",
            background: "#3b82f6",
            color: "white",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ➕ 코멘트 추가
        </button>
      </div>

      {/* 리스트 */}
      {comments.length === 0 ? (
        <div style={{ color: "#9ca3af" }}>등록된 코멘트가 없습니다.</div>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th style={subThStyle}>날짜</th>
              <th style={subThStyle}>코멘트</th>
              <th style={subThStyle}>부모님 답변</th>
            </tr>
          </thead>
          <tbody>
            {comments.map((c) => {
              const text = c.text || c.comment || c.content || "";
              let dateText = "";
              if (c.dateText) dateText = c.dateText;
              else if (c.date) dateText = c.date;
              else if (c.createdAt && c.createdAt.toDate) {
                dateText = c.createdAt.toDate().toISOString().slice(0, 10);
              }

              // comment 문서 안에 answer 필드가 있을 수도 있음
              let inlineAnswer =
                c.answer ||
                c.reply ||
                c.parentAnswer ||
                c.parentReply ||
                "";

              // answer 컬렉션에서 같은 날짜의 부모님 답변들 묶어오기
              const answerList = dateText
                ? answersByDate[dateText] || []
                : [];

              let mergedAnswer = "";
              if (inlineAnswer && answerList.length > 0) {
                mergedAnswer =
                  inlineAnswer + "\n------\n" + answerList.join("\n------\n");
              } else if (inlineAnswer) {
                mergedAnswer = inlineAnswer;
              } else if (answerList.length > 0) {
                mergedAnswer = answerList.join("\n------\n");
              }

              return (
                <tr key={c.id}>
                  <td style={subTdStyle}>{dateText || "-"}</td>
                  <td style={subTdStyle}>{text || "-"}</td>
                  <td style={subTdStyle}>
                    {mergedAnswer ? (
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                        }}
                      >
                        {mergedAnswer}
                      </pre>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <details style={{ marginTop: 6 }}>
        <summary
          style={{
            fontSize: 11,
            color: "#6b7280",
            cursor: "pointer",
          }}
        >
          코멘트/answer raw 데이터 보기
        </summary>
        <pre
          style={{
            fontSize: 11,
            background: "#f3f4f6",
            padding: 6,
            borderRadius: 4,
            marginTop: 4,
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          {JSON.stringify({ comments, answers }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const labelStyle = {
  fontWeight: "bold",
  color: "#374151",
};

const subThStyle = {
  textAlign: "left",
  padding: 4,
  borderBottom: "1px solid #d1d5db",
};

const subTdStyle = {
  padding: 4,
  borderBottom: "1px solid #e5e7eb",
  verticalAlign: "top",
};

export default StudentsPage;
