import { useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Container,
  Flex,
  Grid,
  Heading,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react'
import FranceDepartments from '@svg-maps/france.departments'

const LEVELS = {
  green: { label: 'Vert', color: '#2f9e44', bg: '#eaf7ed' },
  yellow: { label: 'Jaune', color: '#b7791f', bg: '#fff8db' },
  orange: { label: 'Orange', color: '#c05621', bg: '#fff0e6' },
  red: { label: 'Rouge', color: '#c53030', bg: '#ffe8e8' },
  unknown: { label: 'Non renseigné', color: '#94a3b8', bg: '#eef2f6' },
}

const DEPARTMENT_DATA = {
  '01': { name: 'Ain', level: 'red', offers: 292, companies: 14240, formations: 418 },
  '13': { name: 'Bouches-du-Rhône', level: 'orange', offers: 438, companies: 29750, formations: 872 },
  '35': { name: 'Ille-et-Vilaine', level: 'green', offers: 318, companies: 19800, formations: 690 },
  '44': { name: 'Loire-Atlantique', level: 'yellow', offers: 361, companies: 24180, formations: 744 },
  '49': { name: 'Maine-et-Loire', level: 'yellow', offers: 205, companies: 15120, formations: 512 },
  '69': { name: 'Rhône', level: 'orange', offers: 440, companies: 31120, formations: 984 },
  '72': { name: 'Sarthe', level: 'orange', offers: 237, companies: 16910, formations: 636 },
  '75': { name: 'Paris', level: 'red', offers: 447, companies: 48230, formations: 1214 },
}

function normalizeDepartmentCode(location) {
  const rawCode = String(location.id ?? location.code ?? '')
    .replace(/^department-/, '')
    .toUpperCase()

  if (rawCode === '2A' || rawCode === '2B') return rawCode
  return rawCode.padStart(2, '0')
}

function Metric({ label, value }) {
  return (
    <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="2xl" p="5">
      <Text color="gray.500" fontSize="sm">{label}</Text>
      <Text mt="1" fontSize="2xl" fontWeight="800" color="#17324d">
        {value === null ? 'À importer' : value.toLocaleString('fr-FR')}
      </Text>
    </Box>
  )
}

function FranceMap({ selectedCode, onSelect }) {
  const locations = FranceDepartments.locations ?? []
  const viewBox = FranceDepartments.viewBox ?? '0 0 1000 1000'

  return (
    <Box mt="6" className="france-map-wrapper">
      <svg
        className="france-map"
        viewBox={viewBox}
        role="img"
        aria-label="Carte interactive des départements français"
      >
        {locations.map((location) => {
          const code = normalizeDepartmentCode(location)
          const department = DEPARTMENT_DATA[code]
          const level = LEVELS[department?.level ?? 'unknown']
          const selected = code === selectedCode

          return (
            <path
              key={location.id}
              id={`department-${code}`}
              name={location.name}
              d={location.path}
              fill={level.color}
              stroke={selected ? '#102a43' : '#ffffff'}
              strokeWidth={selected ? 3.2 : 1.15}
              tabIndex="0"
              role="button"
              aria-label={`${location.name}, vigilance ${level.label}`}
              className="department-shape"
              onClick={() => onSelect(code)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(code)
                }
              }}
            >
              <title>{`${location.name} (${code}) — ${level.label}`}</title>
            </path>
          )
        })}
      </svg>
    </Box>
  )
}

function App() {
  const [selectedCode, setSelectedCode] = useState('72')

  const selected = useMemo(() => {
    const mapLocation = (FranceDepartments.locations ?? []).find(
      (location) => normalizeDepartmentCode(location) === selectedCode,
    )

    return {
      code: selectedCode,
      name: DEPARTMENT_DATA[selectedCode]?.name ?? mapLocation?.name ?? 'Département',
      level: DEPARTMENT_DATA[selectedCode]?.level ?? 'unknown',
      offers: DEPARTMENT_DATA[selectedCode]?.offers ?? null,
      companies: DEPARTMENT_DATA[selectedCode]?.companies ?? null,
      formations: DEPARTMENT_DATA[selectedCode]?.formations ?? null,
    }
  }, [selectedCode])

  const selectedLevel = LEVELS[selected.level]

  return (
    <Box minH="100vh" bg="#f4f7fa">
      <Box bg="#17324d" color="white" py={{ base: '8', md: '12' }}>
        <Container maxW="7xl">
          <Text color="#9fd3ff" fontWeight="900" letterSpacing="0.16em">APPRENTIFR</Text>
          <Heading mt="3" fontSize={{ base: '4xl', md: '6xl' }} maxW="900px">
            La météo quotidienne de l’apprentissage
          </Heading>
          <Text mt="5" maxW="760px" color="#d9e8f5" fontSize="lg" lineHeight="1.8">
            Une lecture départementale des entreprises, des offres, des formations et des tensions du marché.
          </Text>
        </Container>
      </Box>

      <Container maxW="7xl" py={{ base: '6', md: '10' }}>
        <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1.35fr) minmax(320px, 0.65fr)' }} gap="6">
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="3xl" p={{ base: '5', md: '7' }}>
            <Flex justify="space-between" align="center" gap="4" wrap="wrap">
              <Box>
                <Text color="#457b9d" fontWeight="900" fontSize="sm">CARTE INTERACTIVE</Text>
                <Heading mt="1" color="#17324d" fontSize="2xl">Vigilance par département</Heading>
              </Box>
              <Badge px="3" py="2" borderRadius="full" bg="#edf6ff" color="#24557a">
                Prototype SVG
              </Badge>
            </Flex>

            <FranceMap selectedCode={selectedCode} onSelect={setSelectedCode} />

            <Flex mt="6" gap="4" wrap="wrap">
              {Object.entries(LEVELS).map(([key, level]) => (
                <Flex key={key} align="center" gap="2">
                  <Box boxSize="3" borderRadius="full" bg={level.color} />
                  <Text fontSize="sm" color="gray.600">{level.label}</Text>
                </Flex>
              ))}
            </Flex>
          </Box>

          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="3xl" p={{ base: '5', md: '7' }}>
            <Text color="#457b9d" fontWeight="900" fontSize="sm">BULLETIN LOCAL</Text>
            <Flex mt="3" justify="space-between" align="start" gap="4">
              <Box>
                <Heading color="#17324d" fontSize="3xl">{selected.name}</Heading>
                <Text mt="1" color="gray.500">Département {selected.code}</Text>
              </Box>
              <Badge px="4" py="2" borderRadius="full" bg={selectedLevel.bg} color={selectedLevel.color}>
                {selectedLevel.label}
              </Badge>
            </Flex>

            <SimpleGrid mt="7" columns={1} gap="3">
              <Metric label="Offres actives" value={selected.offers} />
              <Metric label="Entreprises employeuses" value={selected.companies} />
              <Metric label="Formations recensées" value={selected.formations} />
            </SimpleGrid>

            <Box mt="6" p="5" borderRadius="2xl" bg="#f7fafc">
              <Text fontWeight="800" color="#17324d">Collecte progressive</Text>
              <Text mt="2" color="gray.600" lineHeight="1.7">
                Les départements gris ne disposent pas encore de données publiées. La collecte INSEE traitera au minimum trois nouveaux départements par jour jusqu’à couverture complète.
              </Text>
            </Box>
          </Box>
        </Grid>
      </Container>
    </Box>
  )
}

export default App
