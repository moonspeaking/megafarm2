import sys, idapro
idapro.enable_console_messages(False)
path = sys.argv[1]
vt_ea = int(sys.argv[2], 0)
n = int(sys.argv[3]) if len(sys.argv) > 3 else 16
idapro.open_database(path, True)
import ida_bytes, ida_funcs, idc
for i in range(n):
    ea = ida_bytes.get_dword(vt_ea + 4 * i)
    if ea == 0:
        break
    name = ida_funcs.get_func_name(ea) or "?"
    print(f"[{i}] 0x{ea:x} {name}")
idapro.close_database(False)
