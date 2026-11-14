import sys, idapro
idapro.enable_console_messages(False)
idapro.open_database(sys.argv[1], True)
import ida_ua, ida_bytes, ida_name
ea = int(sys.argv[2], 0)
insn = ida_ua.insn_t()
ida_ua.decode_insn(insn, ea)
# print operand values
import ida_ua
for i in range(3):
    op = insn.ops[i]
    if op.type == 0:  # o_void
        break
    val = op.addr if op.type in (5, 7, 8) else op.value  # o_mem/near/far use addr
    print(f"op{i}: type={op.type} value=0x{op.value:x} addr=0x{op.addr:x}")
idapro.close_database(False)
