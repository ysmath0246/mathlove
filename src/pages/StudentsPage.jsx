// src/pages/StudentsPage.jsx
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
  updateDoc,
  where, // ✅ newenroll 필터용
} from "firebase/firestore";

const TAB_LABELS = {
  current: "재원생",
  new: "신규생",
  quit: "퇴원생",
};

const PAGE_SIZE = 6;

function StudentsPage() {
  const [tab, setTab] = useState("current");

  const [currentStudents, setCurrentStudents] = useState([]);
  const [newStudents, setNewStudents] = useState([]);
  const [quitStudents, setQuitStudents] = useState([]);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);

  // 🔹 반 설정(class_types) 목록
  const [classTypes, setClassTypes] = useState([]);

  // 신규 등록 폼 토글 + 상태 (재원생 직접 등록용)
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: "",
    birth: "",
    parentPhone: "",
    studentPhone: "",
    startDate: "",
  });

  // ───── 재원생(students) 구독 ─────
  useEffect(() => {
    const ref = collection(db, "students");
    const qy = query(ref, orderBy("name", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCurrentStudents(list);
    });
  }, []);

  // ───── 신규생(newstudent) 구독 ─────
  useEffect(() => {
    const ref = collection(db, "newstudent");
    const qy = query(ref, orderBy("studentName", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNewStudents(list);
    });
  }, []);

  // ───── 퇴원생(students_quit) 구독 ─────
  useEffect(() => {
    const ref = collection(db, "students_quit");
    const qy = query(ref, orderBy("name", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setQuitStudents(list);
    });
  }, []);

  // ───── 반 설정(class_types) 구독 ─────
  useEffect(() => {
    const ref = collection(db, "class_types");
    const qy = query(ref, orderBy("order", "asc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // isActive가 false인 건 숨기고, undefined / true는 표시
        .filter((ct) => ct.isActive !== false);
      setClassTypes(list);
    });
  }, []);

  // 현재 탭 리스트
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

  // 페이지 계산
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

  // 탭 바뀔 때 초기화
  useEffect(() => {
    setSelectedId(null);
    setSearch("");
    setPageIndex(0);
  }, [tab]);

  // 검색 바뀔 때 페이지 0으로
  useEffect(() => {
    setPageIndex(0);
  }, [search]);

  // ───── 신규생에서 폼으로 불러오기 (재원생 등록용) ─────
  const handleLoadFromNewStudent = () => {
    const src = selectedId
      ? newStudents.find((s) => s.id === selectedId) || null
      : null;

    if (!src) {
      alert("신규생 탭에서 불러올 학생을 먼저 선택해 주세요.");
      return;
    }

    const name = src.name || src.studentName || "";
    const birth =
      src.studentBirth || src.birth || src.birthday || src.birthDate || "";
    const parentPhone =
      src.parentPhone || src.parentTel || src.parentPhoneNumber || "";
    const studentPhone = src.studentPhone || src.phone || "";
    const startDate =
      src.startDate || src.classStartDate || src.beginDate || "";

    setNewStudent({
      name,
      birth,
      parentPhone,
      studentPhone,
      startDate,
    });

    setShowRegisterForm(true);
  };

  // ───── 재원생 신규 등록(직접 입력) ─────
  const handleRegisterNewStudent = async () => {
    const name = newStudent.name.trim();
    if (!name) {
      alert("학생 이름은 필수입니다.");
      return;
    }

    try {
      const birth = newStudent.birth.trim();
      const parentPhone = newStudent.parentPhone.trim();
      const studentPhone = newStudent.studentPhone.trim();
      const startDate = newStudent.startDate.trim();

      const payload = {
        name,
        studentName: name,
        birth,
        studentBirth: birth,
        parentPhone,
        studentPhone,
        startDate,
        status: "재원생",
        // 처음 등록 시에는 반 정보 비워둠(나중에 상세에서 선택)
        classTypes: [],
        createdAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "students"), payload);

      setSelectedId(ref.id);
      setNewStudent({
        name: "",
        birth: "",
        parentPhone: "",
        studentPhone: "",
        startDate: "",
      });
      setShowRegisterForm(false);

      alert("새 재원생이 등록되었습니다.");
    } catch (e) {
      console.error("학생 등록 오류:", e);
      alert("학생 등록 중 오류가 발생했습니다.");
    }
  };

  // ───── 신규생 → 재원생 승인 ─────
  const handleApproveNewStudent = async (student) => {
    if (
      !window.confirm(
        `${student.name || student.studentName || ""} 학생을 재원생으로 승인할까요?`
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

      // schedules 있으면 그대로, 없으면 비워두기
      const schedulesArray =
        Array.isArray(student.schedules) && student.schedules.length > 0
          ? student.schedules
          : [];

      await setDoc(doc(db, "students", student.id), {
        ...rest,
        name,
        studentName: name,
        birth,
        studentBirth: birth,
        parentPhone,
        studentPhone,
        startDate,
        schedules: schedulesArray,
        status: "재원생",
        // newstudent에 classTypes 있으면 유지, 없으면 빈 배열
        classTypes: Array.isArray(student.classTypes)
          ? student.classTypes
          : [],
        approvedAt: serverTimestamp(),
      });

      await deleteDoc(doc(db, "newstudent", student.id));

      alert("재원생으로 승인되었습니다.");
    } catch (e) {
      console.error("신규생 승인 오류:", e);
      alert("승인 중 오류가 발생했습니다.");
    }
  };

  // ───── 재원생 → 퇴원 ─────
  const handleQuitStudent = async (student) => {
    if (
      !window.confirm(
        `${student.name || student.studentName || ""} 학생을 퇴원 처리할까요?`
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

      const schedulesArray =
        Array.isArray(student.schedules) && student.schedules.length > 0
          ? student.schedules
          : [];

      await setDoc(doc(db, "students_quit", student.id), {
        ...rest,
        name,
        studentName: name,
        birth,
        studentBirth: birth,
        parentPhone,
        studentPhone,
        startDate,
        schedules: schedulesArray,
        status: "퇴원",
        // 퇴원할 때도 classTypes 유지
        classTypes: Array.isArray(student.classTypes)
          ? student.classTypes
          : [],
        quitAt: serverTimestamp(),
      });

      await deleteDoc(doc(db, "students", student.id));

      alert("퇴원 처리되었습니다.");
    } catch (e) {
      console.error("퇴원 처리 오류:", e);
      alert("퇴원 처리 중 오류가 발생했습니다.");
    }
  };

  // ───── 퇴원생 → 재원생 복귀 ─────
  const handleRestoreStudent = async (student) => {
    if (
      !window.confirm(
        `${student.name || student.studentName || ""} 학생의 퇴원을 취소하고 재원생으로 복귀할까요?`
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

      const schedulesArray =
        Array.isArray(student.schedules) && student.schedules.length > 0
          ? student.schedules
          : [];

      await setDoc(doc(db, "students", student.id), {
        ...rest,
        name,
        studentName: name,
        birth,
        studentBirth: birth,
        parentPhone,
        studentPhone,
        startDate,
        schedules: schedulesArray,
        status: "재원생",
        // 복귀 시에도 기존 classTypes 유지
        classTypes: Array.isArray(student.classTypes)
          ? student.classTypes
          : [],
        restoredFromQuitAt: serverTimestamp(),
      });

      await deleteDoc(doc(db, "students_quit", student.id));

      alert("재원생으로 복귀되었습니다.");
    } catch (e) {
      console.error("복귀 처리 오류:", e);
      alert("복귀 처리 중 오류가 발생했습니다.");
    }
  };

  return (
    <div style={{ fontSize: 13 }}>
      {/* 헤더 + 탭 + 신규등록/불러오기 버튼 */}
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
        <h2 style={{ fontSize: 18, fontWeight: "bold" }}>학생 관리</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={handleLoadFromNewStudent}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #0ea5e9",
              background: "white",
              color: "#0ea5e9",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            신규생에서 불러오기
          </button>

          <button
            type="button"
            onClick={() => setShowRegisterForm((v) => !v)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #16a34a",
              background: showRegisterForm ? "#16a34a" : "white",
              color: showRegisterForm ? "white" : "#16a34a",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {showRegisterForm ? "등록 폼 닫기" : "➕ 신규 학생 등록"}
          </button>

          <div
            style={{
              display: "inline-flex",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            {["current", "new", "quit"].map((t) => (
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
      </div>

      {/* 재원생 신규 등록 폼 */}
      {showRegisterForm && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: "bold",
              marginBottom: 8,
            }}
          >
            신규 재원생 등록
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <input
              placeholder="학생 이름"
              value={newStudent.name}
              onChange={(e) =>
                setNewStudent((prev) => ({ ...prev, name: e.target.value }))
              }
              style={inputStyle}
            />
            <input
              placeholder="생년월일 (예: 2015-03-02)"
              value={newStudent.birth}
              onChange={(e) =>
                setNewStudent((prev) => ({ ...prev, birth: e.target.value }))
              }
              style={inputStyle}
            />
            <input
              placeholder="수업 시작일 (예: 2025-03-02)"
              value={newStudent.startDate}
              onChange={(e) =>
                setNewStudent((prev) => ({
                  ...prev,
                  startDate: e.target.value,
                }))
              }
              style={inputStyle}
            />
            <input
              placeholder="학부모 전화번호"
              value={newStudent.parentPhone}
              onChange={(e) =>
                setNewStudent((prev) => ({
                  ...prev,
                  parentPhone: e.target.value,
                }))
              }
              style={inputStyle}
            />
            <input
              placeholder="학생 전화번호"
              value={newStudent.studentPhone}
              onChange={(e) =>
                setNewStudent((prev) => ({
                  ...prev,
                  studentPhone: e.target.value,
                }))
              }
              style={inputStyle}
            />
          </div>

          <button
            type="button"
            onClick={handleRegisterNewStudent}
            style={{
              padding: "5px 12px",
              borderRadius: 4,
              border: "none",
              background: "#3b82f6",
              color: "white",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            재원생으로 등록
          </button>
        </div>
      )}

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
          {/* 왼쪽: 학생 목록 */}
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
                  {totalPages === 0
                    ? "0 / 0"
                    : `${safePageIndex + 1} / ${totalPages}`}
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

          {/* 오른쪽: 상세 정보 */}
          <div style={{ flex: 1, paddingLeft: 4 }}>
            {selectedStudent ? (
              <div
                style={{
                  marginBottom: 8,
                  paddingBottom: 6,
                  borderBottom: "1px dashed #e5e7eb",
                }}
              >
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
              </div>
            ) : (
              <div
                style={{
                  marginBottom: 8,
                  paddingBottom: 6,
                  borderBottom: "1px dashed #e5e7eb",
                  fontSize: 12,
                  color: "#9ca3af",
                }}
              >
                왼쪽에서 학생을 선택하면 상세 정보가 보입니다.
              </div>
            )}

            <StudentDetail
              key={`${selectedId || "none"}_${tab}`}
              tab={tab}
              student={selectedStudent}
              onApprove={handleApproveNewStudent}
              onQuit={handleQuitStudent}
              onRestore={handleRestoreStudent}
              // 🔹 반 목록 전달
              classTypes={classTypes}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 상세 정보 + 스케줄/신규상담 정보 */
function StudentDetail({
  tab,
  student,
  onApprove,
  onQuit,
  onRestore,
  classTypes,
}) {
  const [editName, setEditName] = useState("");
  const [editBirth, setEditBirth] = useState("");
  const [editParentPhone, setEditParentPhone] = useState("");
  const [editStudentPhone, setEditStudentPhone] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editSchedules, setEditSchedules] = useState([]);

  // 🔹 학생이 속한 반들 (문자 label 배열)
  const [editClassTypes, setEditClassTypes] = useState([]);

  // 신규 상담 & 신청 정보
  const [newEnrolls, setNewEnrolls] = useState([]); // newenroll 컬렉션
  const [operationEnroll, setOperationEnroll] = useState(null); // operation_enroll

  useEffect(() => {
    if (!student) {
      setEditName("");
      setEditBirth("");
      setEditParentPhone("");
      setEditStudentPhone("");
      setEditStartDate("");
      setEditSchedules([]);
      setNewEnrolls([]);
      setOperationEnroll(null);
      setEditClassTypes([]);
      return;
    }

    setEditName(student.name || student.studentName || "");
    setEditBirth(student.studentBirth || student.birth || "");
    setEditParentPhone(student.parentPhone || student.parentTel || "");
    setEditStudentPhone(student.studentPhone || student.phone || "");
    setEditStartDate(student.startDate || "");

    if (student.schedules && Array.isArray(student.schedules)) {
      setEditSchedules(student.schedules);
    } else {
      setEditSchedules([{ day: "", time: "" }]);
    }

    if (Array.isArray(student.classTypes)) {
      setEditClassTypes(student.classTypes);
    } else {
      setEditClassTypes([]);
    }
  }, [student]);

  // 신규생 탭일 때만 newenroll / operation_enroll 읽기
  useEffect(() => {
    if (!student || tab !== "new") {
      setNewEnrolls([]);
      setOperationEnroll(null);
      return;
    }

    const sname = student.name || student.studentName || "";
    const phone =
      student.parentPhone || student.parentTel || student.parentPhoneNumber || "";
    const birth = student.studentBirth || student.birth || "";

    // newenroll: 학생 이름 + 학부모폰(+생년월일) 기준으로 검색
    const baseRef = collection(db, "newenroll");
    const conds = [];
    if (sname) conds.push(where("studentName", "==", sname));
    if (phone) conds.push(where("parentPhone", "==", phone));
    if (birth) conds.push(where("studentBirth", "==", birth));

    const qRef = conds.length ? query(baseRef, ...conds) : baseRef;

    const unsub1 = onSnapshot(qRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNewEnrolls(list);
    });

    // operation_enroll: 문서 ID = 학생 이름
    const opRef = doc(db, "operation_enroll", sname || "___dummy___");
    const unsub2 = onSnapshot(opRef, (snap) => {
      if (snap.exists()) {
        setOperationEnroll({ id: snap.id, ...snap.data() });
      } else {
        setOperationEnroll(null);
      }
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [student, tab]);

  if (!student) return null;

  const saveBasicInfo = async () => {
    if (!editName.trim()) return alert("이름은 비워둘 수 없어요!");

    const col =
      tab === "current"
        ? "students"
        : tab === "new"
        ? "newstudent"
        : "students_quit";

    await updateDoc(doc(db, col, student.id), {
      name: editName,
      studentName: editName,
      birth: editBirth,
      studentBirth: editBirth,
      parentPhone: editParentPhone,
      studentPhone: editStudentPhone,
      startDate: editStartDate,
      // 🔹 반 정보 저장
      classTypes: editClassTypes,
    });

    alert("✔ 기본 정보 저장 완료!");
  };

  const changeSchedule = (idx, field, val) => {
    setEditSchedules((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const addSchedule = () => {
    setEditSchedules((prev) => [...prev, { day: "", time: "" }]);
  };

  const removeSchedule = (idx) => {
    setEditSchedules((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [{ day: "", time: "" }];
    });
  };

  const saveSchedules = async () => {
    if (tab !== "current") return alert("스케줄 저장은 재원생만 가능!");

    const cleaned = editSchedules.filter((s) => s.day || s.time);

    await updateDoc(doc(db, "students", student.id), {
      schedules: cleaned,
      days: cleaned.map((s) => s.day),
      time: cleaned.map((s) => s.time).join(", "),
    });

    alert("📌 스케줄 저장 완료!");
  };

  const consultType = student.consultType || "";
  const siblingName = student.siblingName || "";
  const referralName = student.referralName || "";

  const toggleClassType = (label) => {
    setEditClassTypes((prev) =>
      prev.includes(label)
        ? prev.filter((t) => t !== label)
        : [...prev, label]
    );
  };

  return (
    <div style={{ fontSize: 12 }}>
      {/* 기본 정보 편집 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          rowGap: 6,
          marginBottom: 12,
        }}
      >
        <div style={labelStyle}>이름</div>
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />

        <div style={labelStyle}>생년월일</div>
        <input
          value={editBirth}
          onChange={(e) => setEditBirth(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />

        <div style={labelStyle}>학부모 폰</div>
        <input
          value={editParentPhone}
          onChange={(e) => setEditParentPhone(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />

        <div style={labelStyle}>학생 폰</div>
        <input
          value={editStudentPhone}
          onChange={(e) => setEditStudentPhone(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />

        <div style={labelStyle}>수업 시작일</div>
        <input
          value={editStartDate}
          onChange={(e) => setEditStartDate(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />

        {/* 🔹 반 선택(중복 가능) */}
        <div style={labelStyle}>반</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(!classTypes || classTypes.length === 0) && (
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              반 설정 탭에서 먼저 반을 등록해주세요.
            </div>
          )}
          {classTypes &&
            classTypes.map((ct) => {
              const label = ct.label || "";
              const checked = editClassTypes.includes(label);
              return (
                <label
                  key={ct.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px",
                    borderRadius: 999,
                    border: "1px solid #d1d5db",
                    background: checked ? "#eff6ff" : "white",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleClassType(label)}
                    style={{ width: 10, height: 10 }}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
        </div>
      </div>

      <button
        onClick={saveBasicInfo}
        style={{
          padding: "6px 10px",
          borderRadius: 4,
          background: "#10b981",
          color: "white",
          fontSize: 11,
          cursor: "pointer",
          marginBottom: 10,
        }}
      >
        💾 기본 정보 저장
      </button>

      {/* 위쪽 액션 버튼 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {tab === "new" && (
          <button
            onClick={() => onApprove && onApprove(student)}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              background: "#16a34a",
              color: "white",
              cursor: "pointer",
            }}
          >
            ▶ 재원 등록
          </button>
        )}

        {tab === "current" && (
          <button
            onClick={() => onQuit && onQuit(student)}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              background: "#dc2626",
              color: "white",
              cursor: "pointer",
            }}
          >
            🚫 퇴원 처리
          </button>
        )}

        {tab === "quit" && (
          <button
            onClick={() => onRestore && onRestore(student)}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              background: "#0ea5e9",
              color: "white",
              cursor: "pointer",
            }}
          >
            🔄 복귀
          </button>
        )}
      </div>

      {/* 재원생: 스케줄 편집 폼 (신규/퇴원 탭에서는 아예 안보이게) */}
      {tab === "current" && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            padding: 10,
            borderRadius: 8,
            background: "#f9fafb",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            수업 스케줄 수정
          </div>

          {editSchedules.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <input
                placeholder="요일"
                value={s.day}
                onChange={(e) => changeSchedule(i, "day", e.target.value)}
                style={{ ...inputStyle, width: 60 }}
              />
              <input
                placeholder="시간"
                value={s.time}
                onChange={(e) => changeSchedule(i, "time", e.target.value)}
                style={{ ...inputStyle, width: 100 }}
              />

              <button
                onClick={() => removeSchedule(i)}
                style={{
                  fontSize: 11,
                  padding: "4px 6px",
                  background: "#fff",
                  border: "1px solid #dc2626",
                  color: "#dc2626",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                삭제
              </button>
            </div>
          ))}

          <button
            onClick={addSchedule}
            style={{
              marginTop: 6,
              padding: "4px 10px",
              fontSize: 11,
              background: "white",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              cursor: "pointer",
              marginRight: 6,
            }}
          >
            + 추가
          </button>

          <button
            onClick={saveSchedules}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              background: "#3b82f6",
              color: "white",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            💾 스케줄 저장
          </button>
        </div>
      )}

      {/* 신규생: 상담 + newenroll + 집중학습반 신청 정보 보여주기 */}
      {tab === "new" && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            padding: 10,
            borderRadius: 8,
            background: "#f9fafb",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            신규 상담 / 신청 정보
          </div>

          <div style={{ marginBottom: 4 }}>
            <b>상담 방법(consultType)</b> : {consultType || "-"}
          </div>
          <div style={{ marginBottom: 4 }}>
            <b>재원 형제자매 이름(siblingName)</b> : {siblingName || "-"}
          </div>
          <div style={{ marginBottom: 8 }}>
            <b>소개해 주신 분(referralName)</b> : {referralName || "-"}
          </div>

          <div style={{ borderTop: "1px dashed #d1d5db", margin: "6px 0" }} />

          <div style={{ marginBottom: 4, fontWeight: "bold" }}>
            📅 2026 수강 신청(newenroll)
          </div>
          {newEnrolls.length === 0 ? (
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              newenroll 컬렉션에 신청 내역이 없습니다.
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 11,
                marginBottom: 8,
              }}
            >
              <thead>
                <tr style={{ background: "#e5e7eb" }}>
                  <th style={thSmall}>반</th>
                  <th style={thSmall}>요일</th>
                  <th style={thSmall}>시간</th>
                  <th style={thSmall}>라벨</th>
                  <th style={thSmall}>상태</th>
                </tr>
              </thead>
              <tbody>
                {newEnrolls.map((e) => (
                  <tr key={e.id}>
                    <td style={tdSmall}>{e.group || "-"}</td>
                    <td style={tdSmall}>{e.day || "-"}</td>
                    <td style={tdSmall}>{e.time || "-"}</td>
                    <td style={tdSmall}>{e.label || "-"}</td>
                    <td style={tdSmall}>{e.status || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ borderTop: "1px dashed #d1d5db", margin: "6px 0" }} />

          <div style={{ marginBottom: 4, fontWeight: "bold" }}>
            ✏ 집중학습반 신청(operation_enroll)
          </div>
          {operationEnroll ? (
            <div style={{ fontSize: 11 }}>
              집중학습반 시간: <b>{operationEnroll.time || "-"}</b>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              operation_enroll 컬렉션에 집중학습반 신청 내역이 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  fontWeight: "bold",
  color: "#374151",
};

const inputStyle = {
  padding: "4px 8px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #d1d5db",
  minWidth: 140,
};

const thSmall = {
  textAlign: "left",
  padding: 4,
  borderBottom: "1px solid #d1d5db",
};

const tdSmall = {
  padding: 4,
  borderBottom: "1px solid #e5e7eb",
};

export default StudentsPage;
