// src/pages/EnrollmentsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  getDocs,
} from "firebase/firestore";

const enrollLabelByGroup = {
  elementary: "초등부",
  middle: "중등부",
  middleClinic: "중등부 클리닉",
};

function EnrollmentsPage() {
  const [enrollGroup, setEnrollGroup] = useState("elementary");
  const [enrollments, setEnrollments] = useState([]);
  const [selectedSlotKey, setSelectedSlotKey] = useState(null);

  // 중등부 클리닉 요일별 명단
  const [middleClinicByDay, setMiddleClinicByDay] = useState({
    월: [],
    화: [],
    수: [],
    목: [],
    금: [],
  });

  // 수강신청(enrollments) 실시간
  useEffect(() => {
    const ref = collection(db, "enrollments");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEnrollments(list);
    });
  }, []);

  // 중등부 클리닉 요일별 실시간
  useEffect(() => {
    const ref = collection(db, "middle_clinic_days");

    return onSnapshot(ref, (qs) => {
      const map = { 월: [], 화: [], 수: [], 목: [], 금: [] };

      qs.forEach((d) => {
        const data = d.data();
        const name = data.studentName || data.name || "";
        const daysArr = Array.isArray(data.days) ? data.days : [];

        daysArr.forEach((day) => {
          if (!map[day]) map[day] = [];
          if (name) map[day].push(name);
        });
      });

      Object.keys(map).forEach((day) => {
        map[day].sort((a, b) => a.localeCompare(b, "ko-KR"));
      });

      setMiddleClinicByDay(map);
    });
  }, []);

  // 시간표(초/중)
  const enrollSchedules = useMemo(
    () => ({
      elementary: {
        월: ["2시30분"],
        화: ["3시", "4시"],
        수: ["2시", "3시", "4시"],
        목: ["3시", "4시"],
        금: ["3시", "4시"],
      },
      middle: {
        월: ["3시30분", "5시", "6시30분"],
        화: ["5시", "6시30분"],
        수: ["5시", "6시30분"],
        목: ["5시", "6시30분"],
        금: ["5시", "6시30분"],
      },
    }),
    []
  );

  // 실제 신청/예비/대기 인원 수
  const enrollCounts = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => {
      const group = e.group || "";
      const day = e.day || "";
      const time = e.time || "";
      const key = `${group}|${day}|${time}`;

      if (!map[key]) {
        map[key] = { applied: 0, reserve: 0, waitlist: 0 };
      }
      const st = e.status || "applied";
      if (st === "reserve") map[key].reserve += 1;
      else if (st === "waitlist") map[key].waitlist += 1;
      else map[key].applied += 1;
    });
    return map;
  }, [enrollments]);

  // adminHold(보여주기용 인원)만 따로 카운트
  const enrollHoldCounts = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => {
      if (!e.adminHold) return;
      const key = `${e.group || ""}|${e.day || ""}|${e.time || ""}`;
      if (!map[key]) map[key] = { applied: 0, reserve: 0, waitlist: 0 };
      const st = e.status || "applied";
      map[key][st] = (map[key][st] || 0) + 1;
    });
    return map;
  }, [enrollments]);

  // 요일/시간별로 묶은 슬롯들
  const groupedEnrollments = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => {
      const group = e.group || "";
      const day = e.day || "";
      const time = e.time || "";
      const key = `${group}|${day}|${time}`;

      if (!map[key]) {
        map[key] = {
          key,
          group,
          day,
          time,
          applied: 0,
          waitlist: 0,
          pending: 0,
          list: [],
        };
      }

      map[key].list.push(e);
      const status = e.status || "applied";
      if (status === "applied") map[key].applied += 1;
      else if (status === "waitlist") map[key].waitlist += 1;
      else map[key].pending += 1;
    });

    const groupOrder = { elementary: 0, middle: 1 };
    const dayOrder = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

    return Object.values(map).sort((a, b) => {
      const gDiff = (groupOrder[a.group] ?? 99) - (groupOrder[b.group] ?? 99);
      if (gDiff !== 0) return gDiff;
      const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
      if (dDiff !== 0) return dDiff;
      return (a.time || "").localeCompare(b.time || "");
    });
  }, [enrollments]);

  const selectedSlot = useMemo(
    () => groupedEnrollments.find((s) => s.key === selectedSlotKey) || null,
    [groupedEnrollments, selectedSlotKey]
  );

  // 슬롯별 리스트 분리
  const appliedList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlot.list.filter(
      (e) => (e.status || "applied") === "applied"
    );
  }, [selectedSlot]);

  const reserveList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlot.list.filter((e) => (e.status || "") === "reserve");
  }, [selectedSlot]);

  const waitList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlot.list.filter((e) => (e.status || "") === "waitlist");
  }, [selectedSlot]);

  const pendingList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlot.list.filter((e) => {
      const st = e.status || "applied";
      return st !== "applied" && st !== "reserve" && st !== "waitlist";
    });
  }, [selectedSlot]);

  // 예비 → 신청
  const promoteReserveToApplied = async (enr) => {
    if (
      !window.confirm(
        `${enr.studentName} 학생의 예비를 '신청'으로 변경할까요?`
      )
    )
      return;

    try {
      const batch = writeBatch(db);

      const enrollRef = doc(db, "enrollments", enr.id);
      batch.update(enrollRef, { status: "applied" });

      const stuRef = doc(db, "enrollments_by_student", enr.studentName);
      const stuSnap = await getDoc(stuRef);

      if (stuSnap.exists()) {
        const data = stuSnap.data();
        const appliedArr = Array.isArray(data.applied)
          ? data.applied.map((item) => {
              if (
                item.group === enr.group &&
                item.day === enr.day &&
                item.time === enr.time
              ) {
                return {
                  ...item,
                  status: "applied",
                  label: "신청",
                };
              }
              return item;
            })
          : [];

        batch.set(
          stuRef,
          {
            ...data,
            applied: appliedArr,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      alert("예비가 신청으로 변경되었습니다.");
    } catch (e) {
      console.error("예비→신청 변경 오류:", e);
      alert("변경 중 오류가 발생했습니다.");
    }
  };

  // 신청 → 예비
  const demoteAppliedToReserve = async (enr) => {
    if (
      !window.confirm(`${enr.studentName} 학생의 '신청'을 예비로 변경할까요?`)
    )
      return;

    try {
      const batch = writeBatch(db);

      const enrollRef = doc(db, "enrollments", enr.id);
      batch.update(enrollRef, { status: "reserve" });

      const stuRef = doc(db, "enrollments_by_student", enr.studentName);
      const stuSnap = await getDoc(stuRef);

      if (stuSnap.exists()) {
        const data = stuSnap.data();
        const appliedArr = Array.isArray(data.applied)
          ? data.applied.map((item) => {
              if (
                item.group === enr.group &&
                item.day === enr.day &&
                item.time === enr.time
              ) {
                return {
                  ...item,
                  status: "reserve",
                  label: "신청(예비)",
                };
              }
              return item;
            })
          : [];

        batch.set(
          stuRef,
          {
            ...data,
            applied: appliedArr,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      alert("신청이 예비로 변경되었습니다.");
    } catch (e) {
      console.error("신청→예비 변경 오류:", e);
      alert("변경 중 오류가 발생했습니다.");
    }
  };

  // 보여주기용 인원 추가
  const addShowApplicant = async (group, day, time, status = "applied") => {
    try {
      await setDoc(doc(collection(db, "enrollments")), {
        group,
        day,
        time,
        status,
        adminHold: true,
        studentName: "(보여주기)",
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("보여주기 인원 추가 오류:", e);
      alert("보여주기 인원 추가 중 오류");
    }
  };

  // 보여주기용 인원 삭제(1명)
  const removeShowApplicant = async (
    group,
    day,
    time,
    status = "applied"
  ) => {
    try {
      const qy = query(
        collection(db, "enrollments"),
        where("group", "==", group),
        where("day", "==", day),
        where("time", "==", time),
        where("status", "==", status),
        where("adminHold", "==", true),
        limit(1)
      );
      const snap = await getDocs(qy);
      if (snap.empty) {
        alert("보여주기 인원이 없습니다.");
        return;
      }
      await deleteDoc(snap.docs[0].ref);
    } catch (e) {
      console.error("보여주기 인원 삭제 오류:", e);
      alert("보여주기 인원 삭제 중 오류");
    }
  };

  // 전체 리셋
  const handleResetEnrollments = async () => {
    if (
      !window.confirm(
        "⚠️ enrollments / enrollments_by_student 컬렉션의 모든 문서를 삭제합니다. 계속할까요?"
      )
    )
      return;

    try {
      const snap1 = await getDocs(collection(db, "enrollments"));
      await Promise.all(snap1.docs.map((d) => deleteDoc(d.ref)));

      const snap2 = await getDocs(collection(db, "enrollments_by_student"));
      await Promise.all(snap2.docs.map((d) => deleteDoc(d.ref)));

      alert("수강신청 데이터가 모두 삭제되었습니다.");
    } catch (e) {
      console.error("수강신청 리셋 오류:", e);
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  return (
    <div style={{ fontSize: 13 }}>
      {/* 상단 헤더 */}
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
        <h2 style={{ fontSize: 18, fontWeight: "bold" }}>
          수강신청 현황{" "}
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            ({enrollLabelByGroup[enrollGroup]})
          </span>
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div
            style={{
              display: "inline-flex",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            {["elementary", "middle", "middleClinic"].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setEnrollGroup(g)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  border: "none",
                  cursor: "pointer",
                  background:
                    enrollGroup === g ? "#3b82f6" : "rgba(255,255,255,0.9)",
                  color: enrollGroup === g ? "white" : "#374151",
                  fontWeight: "bold",
                }}
              >
                {enrollLabelByGroup[g]}
              </button>
            ))}
          </div>
          <button
            onClick={handleResetEnrollments}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #dc2626",
              background: "white",
              color: "#dc2626",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            전체 리셋
          </button>
        </div>
      </div>

      {/* 본문 박스 */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 8,
          background: "white",
        }}
      >
        {/* 초등 / 중등 시간표 + 슬롯별 인원 */}
        {(enrollGroup === "elementary" || enrollGroup === "middle") && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  minWidth: 560,
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                        width: 80,
                      }}
                    >
                      요일
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      시간 (신청 / 예비 / 대기)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(enrollSchedules[enrollGroup] || {}).map(
                    ([day, times]) => (
                      <tr key={day}>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                            fontWeight: "bold",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {day}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            {times.map((time) => {
                              const key = `${enrollGroup}|${day}|${time}`;
                              const cnt =
                                enrollCounts[key] || {
                                  applied: 0,
                                  reserve: 0,
                                  waitlist: 0,
                                };
                              const total =
                                cnt.applied + cnt.reserve + cnt.waitlist;

                              const hold =
                                enrollHoldCounts[key] || {
                                  applied: 0,
                                  reserve: 0,
                                  waitlist: 0,
                                };

                              return (
                                <div
                                  key={`${day}-${time}`}
                                  style={{
                                    padding: 8,
                                    borderRadius: 8,
                                    border: "1px solid #e5e7eb",
                                    background: "white",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-start",
                                    minWidth: 160,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSelectedSlotKey(key)}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      border: "1px solid #e5e7eb",
                                      background: "white",
                                      cursor: "pointer",
                                      width: "100%",
                                    }}
                                  >
                                    <div style={{ fontWeight: "bold" }}>
                                      {time}
                                    </div>
                                    <div
                                      style={{
                                        marginTop: 4,
                                        fontSize: 11,
                                        color: "#6b7280",
                                      }}
                                    >
                                      신청 {cnt.applied} / 예비 {cnt.reserve} /
                                      대기 {cnt.waitlist}
                                      <span
                                        style={{
                                          marginLeft: 4,
                                          color: "#9ca3af",
                                        }}
                                      >
                                        (총 {total})
                                      </span>
                                    </div>
                                  </button>

                                  {/* 보여주기용 인원 조절 */}
                                  <div
                                    style={{
                                      marginTop: 6,
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 4,
                                      fontSize: 11,
                                      color: "#6b7280",
                                      width: "100%",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontWeight: "bold",
                                        marginBottom: 2,
                                      }}
                                    >
                                      표시용 인원 (adminHold)
                                    </div>

                                    {/* 신청 */}
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <span style={{ width: 42 }}>신청</span>
                                      <span
                                        style={{
                                          minWidth: 20,
                                          textAlign: "right",
                                        }}
                                      >
                                        {hold.applied || 0}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addShowApplicant(
                                            enrollGroup,
                                            day,
                                            time,
                                            "applied"
                                          )
                                        }
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: "white",
                                          cursor: "pointer",
                                        }}
                                      >
                                        +1
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeShowApplicant(
                                            enrollGroup,
                                            day,
                                            time,
                                            "applied"
                                          )
                                        }
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: "white",
                                          cursor: "pointer",
                                        }}
                                      >
                                        -1
                                      </button>
                                    </div>

                                    {/* 예비 */}
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <span style={{ width: 42 }}>예비</span>
                                      <span
                                        style={{
                                          minWidth: 20,
                                          textAlign: "right",
                                        }}
                                      >
                                        {hold.reserve || 0}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addShowApplicant(
                                            enrollGroup,
                                            day,
                                            time,
                                            "reserve"
                                          )
                                        }
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: "white",
                                          cursor: "pointer",
                                        }}
                                      >
                                        +1
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeShowApplicant(
                                            enrollGroup,
                                            day,
                                            time,
                                            "reserve"
                                          )
                                        }
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: "white",
                                          cursor: "pointer",
                                        }}
                                      >
                                        -1
                                      </button>
                                    </div>

                                    {/* 대기 */}
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <span style={{ width: 42 }}>대기</span>
                                      <span
                                        style={{
                                          minWidth: 20,
                                          textAlign: "right",
                                        }}
                                      >
                                        {hold.waitlist || 0}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addShowApplicant(
                                            enrollGroup,
                                            day,
                                            time,
                                            "waitlist"
                                          )
                                        }
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: "white",
                                          cursor: "pointer",
                                        }}
                                      >
                                        +1
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeShowApplicant(
                                            enrollGroup,
                                            day,
                                            time,
                                            "waitlist"
                                          )
                                        }
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: "white",
                                          cursor: "pointer",
                                        }}
                                      >
                                        -1
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            {/* 선택된 슬롯 상세 목록 */}
            {selectedSlot && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 8,
                  borderTop: "1px dashed #e5e7eb",
                }}
              >
                <div
                  style={{
                    fontWeight: "bold",
                    marginBottom: 8,
                    fontSize: 13,
                  }}
                >
                  [
                  {enrollLabelByGroup[selectedSlot.group] ||
                    selectedSlot.group}{" "}
                  ] {selectedSlot.day} {selectedSlot.time} 신청 현황
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                  }}
                >
                  {/* 신청 */}
                  <div
                    style={{
                      minWidth: 180,
                      flex: "1 1 180px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        marginBottom: 4,
                      }}
                    >
                      신청 ({appliedList.length}명)
                    </div>
                    {appliedList.length === 0 ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#9ca3af",
                        }}
                      >
                        신청 인원이 없습니다.
                      </div>
                    ) : (
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                        }}
                      >
                        {appliedList.map((enr) => (
                          <li
                            key={enr.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "2px 0",
                            }}
                          >
                            <span>
                              {enr.studentName || enr.name || "-"}
                            </span>
                            <button
                              type="button"
                              onClick={() => demoteAppliedToReserve(enr)}
                              style={{
                                padding: "1px 6px",
                                fontSize: 10,
                                borderRadius: 4,
                                border: "1px solid #d1d5db",
                                background: "white",
                                cursor: "pointer",
                              }}
                            >
                              예비로
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 예비 */}
                  <div
                    style={{
                      minWidth: 180,
                      flex: "1 1 180px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        marginBottom: 4,
                      }}
                    >
                      예비 ({reserveList.length}명)
                    </div>
                    {reserveList.length === 0 ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#9ca3af",
                        }}
                      >
                        예비 인원이 없습니다.
                      </div>
                    ) : (
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                        }}
                      >
                        {reserveList.map((enr) => (
                          <li
                            key={enr.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "2px 0",
                            }}
                          >
                            <span>
                              {enr.studentName || enr.name || "-"}
                            </span>
                            <button
                              type="button"
                              onClick={() => promoteReserveToApplied(enr)}
                              style={{
                                padding: "1px 6px",
                                fontSize: 10,
                                borderRadius: 4,
                                border: "1px solid #d1d5db",
                                background: "white",
                                cursor: "pointer",
                              }}
                            >
                              신청으로
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 대기 */}
                  <div
                    style={{
                      minWidth: 180,
                      flex: "1 1 180px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        marginBottom: 4,
                      }}
                    >
                      대기 ({waitList.length}명)
                    </div>
                    {waitList.length === 0 ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#9ca3af",
                        }}
                      >
                        대기 인원이 없습니다.
                      </div>
                    ) : (
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                        }}
                      >
                        {waitList.map((enr) => (
                          <li
                            key={enr.id}
                            style={{
                              padding: "2px 0",
                            }}
                          >
                            {enr.studentName || enr.name || "-"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 기타(pending 등) */}
                  {pendingList.length > 0 && (
                    <div
                      style={{
                        minWidth: 180,
                        flex: "1 1 180px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: "bold",
                          marginBottom: 4,
                        }}
                      >
                        기타 ({pendingList.length}명)
                      </div>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                        }}
                      >
                        {pendingList.map((enr) => (
                          <li
                            key={enr.id}
                            style={{
                              padding: "2px 0",
                            }}
                          >
                            {enr.studentName || enr.name || "-"} (
                            {enr.status || "기타"})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* 중등부 클리닉 요일별 명단 */}
        {enrollGroup === "middleClinic" && (
          <div>
            <div
              style={{
                marginBottom: 8,
                fontSize: 13,
                color: "#4b5563",
              }}
            >
              중등부 클리닉은 요일별로 신청 인원만 확인합니다.
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #e5e7eb",
                      width: 80,
                    }}
                  >
                    요일
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #e5e7eb",
                      width: 80,
                    }}
                  >
                    인원
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    명단
                  </th>
                </tr>
              </thead>
              <tbody>
                {["월", "화", "수", "목", "금"].map((day) => {
                  const list = middleClinicByDay[day] || [];
                  return (
                    <tr key={day}>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid #f3f4f6",
                          fontWeight: "bold",
                        }}
                      >
                        {day}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid #f3f4f6",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {list.length}명
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid #f3f4f6",
                          fontSize: 12,
                          color: "#4b5563",
                        }}
                      >
                        {list.length === 0
                          ? "신청 인원이 없습니다."
                          : list.join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default EnrollmentsPage;
