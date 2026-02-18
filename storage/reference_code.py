# Эталонный код (пример)
n = int(input())
a = [int(input()) for _ in range(n)]
mx = max(a); mn = min(a)
print(mx)
print(a.index(mx)+1)
print(mn)
print(a.index(mn)+1)
